import path from "node:path";

export type IssueLevel = "error" | "warning" | "typesetting";

export interface LogIssue {
  level: IssueLevel;
  message: string;
  file?: string;
  line?: number;
  content?: string;
}

const WARNING_RE = /^(?:LaTeX|LaTeX Font|pdfTeX|Package ([\w.-]+)|Class ([\w.-]+)|Module ([\w.-]+)) Warning: (.*)$/;
const BADBOX_RE = /^(Over|Under)full \\([hv])box \((.*?)\)(.*)$/;
const FILE_LINE_ERROR_RE = /^((?:\.{0,2}\/|[A-Za-z]:[\\/]|\/)?[^:\s][^:]*?\.(?:tex|sty|cls|bib|bbl|ltx|dtx|def|cfg|clo|aux|toc|lua|tikz)):(\d+): (.*)$/;
const INPUT_LINE_RE = /on input line (\d+)/;
const BADBOX_LINES_RE = /at lines? (\d+)(?:--(\d+))?|detected at line (\d+)/;

/** Normalises a path from the log to project-relative when it lives inside the project. */
function normaliseFile(raw: string | undefined, root: string, cwd = root): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/^"|"$/g, "");
  const abs = path.resolve(cwd, cleaned);
  const rel = path.relative(root, abs);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  return path.basename(cleaned);
}

/**
 * Lightweight TeX log parser. Expects logs written with a large max_print_line
 * so messages and file paths are not hard-wrapped at 79 columns.
 */
export function parseTexLog(log: string, root: string, cwd = root): LogIssue[] {
  const norm = (f: string | undefined) => normaliseFile(f, root, cwd);
  const lines = log.split(/\r?\n/);
  const issues: LogIssue[] = [];
  const fileStack: (string | null)[] = [];
  const currentFile = () => {
    for (let i = fileStack.length - 1; i >= 0; i--) if (fileStack[i]) return fileStack[i]!;
    return undefined;
  };

  const trackParens = (line: string) => {
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === "(") {
        const rest = line.slice(i + 1);
        const m = /^("[^"]+"|[^\s()"]+)/.exec(rest);
        const candidate = m?.[1];
        if (candidate && /\.[A-Za-z0-9]{1,8}"?$/.test(candidate) && /[/.]/.test(candidate[0] === '"' ? candidate[1] : candidate[0] ?? "")) {
          fileStack.push(candidate.replace(/^"|"$/g, ""));
          i += 1 + candidate.length;
          continue;
        }
        if (candidate && /^(\.{0,2}\/|\/)/.test(candidate)) {
          fileStack.push(candidate.replace(/^"|"$/g, ""));
          i += 1 + candidate.length;
          continue;
        }
        fileStack.push(null);
      } else if (ch === ")") {
        fileStack.pop();
      }
      i++;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fle = FILE_LINE_ERROR_RE.exec(line);
    if (fle) {
      const [, file, lineNo, message] = fle;
      const { content, next } = collectErrorContext(lines, i + 1);
      issues.push({ level: "error", message: message.trim(), file: norm(file), line: Number(lineNo), content });
      i = next - 1;
      continue;
    }

    if (line.startsWith("! ")) {
      const { content, next, lineNo } = collectErrorContext(lines, i + 1);
      issues.push({
        level: "error",
        message: line.slice(2).trim(),
        file: norm(currentFile()),
        line: lineNo,
        content,
      });
      i = next - 1;
      continue;
    }

    const w = WARNING_RE.exec(line);
    if (w) {
      const pkg = w[1] ?? w[2] ?? w[3];
      let message = w[4];
      // Package warnings continue on lines prefixed with "(pkgname)".
      let j = i + 1;
      while (j < lines.length && pkg && lines[j].startsWith(`(${pkg})`)) {
        message += " " + lines[j].slice(pkg.length + 2).trim();
        j++;
      }
      // LaTeX warnings may wrap onto plain follow-up lines until a blank line.
      if (!pkg) {
        while (j < lines.length && lines[j].trim() !== "" && !/^[(!)\\]/.test(lines[j]) && !WARNING_RE.test(lines[j]) && j - i < 4) {
          message += " " + lines[j].trim();
          j++;
        }
      }
      const ln = INPUT_LINE_RE.exec(message);
      issues.push({
        level: "warning",
        message: (pkg ? `${pkg}: ` : "") + message.replace(/\s+/g, " ").trim(),
        file: norm(currentFile()),
        line: ln ? Number(ln[1]) : undefined,
      });
      i = j - 1;
      continue;
    }

    const bb = BADBOX_RE.exec(line);
    if (bb) {
      const lm = BADBOX_LINES_RE.exec(line);
      const lineNo = lm ? Number(lm[1] ?? lm[3]) : undefined;
      issues.push({
        level: "typesetting",
        message: line.replace(/\s+/g, " ").trim(),
        file: norm(currentFile()),
        line: lineNo,
      });
      // The offending material follows on the next line(s); skip so parens there don't confuse the stack.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "" && j - i < 4) j++;
      i = j - 1;
      continue;
    }

    trackParens(line);
  }

  return dedupe(issues);
}

function collectErrorContext(lines: string[], start: number) {
  const context: string[] = [];
  let lineNo: number | undefined;
  let j = start;
  let blank = 0;
  while (j < lines.length && context.length < 12) {
    const l = lines[j];
    if (/^\.\/.+:\d+: /.test(l) || l.startsWith("! ")) break;
    const m = /^l\.(\d+)/.exec(l);
    if (m && lineNo === undefined) lineNo = Number(m[1]);
    if (l.trim() === "") {
      blank++;
      if (blank >= 2 || lineNo !== undefined) break;
    } else {
      blank = 0;
    }
    context.push(l);
    j++;
    if (lineNo !== undefined && j < lines.length && lines[j].trim() !== "" && context.length > 0) {
      // Include the continuation line of the l.N context (the text after the error point).
      context.push(lines[j]);
      j++;
      break;
    }
  }
  return { content: context.join("\n").trim() || undefined, next: j, lineNo };
}

function dedupe(issues: LogIssue[]) {
  const seen = new Set<string>();
  return issues.filter((x) => {
    const k = `${x.level}|${x.file}|${x.line}|${x.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Parses BibTeX / Biber .blg output. */
export function parseBlg(blg: string, root: string, cwd = root): LogIssue[] {
  const norm = (f: string | undefined) => normaliseFile(f, root, cwd);
  const issues: LogIssue[] = [];
  const lines = blg.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m: RegExpExecArray | null;
    if ((m = /^Warning--(.*)$/.exec(l))) {
      const next = lines[i + 1] ?? "";
      const where = /--line (\d+) of file (.+)$/.exec(next);
      issues.push({ level: "warning", message: `BibTeX: ${m[1]}`, file: where ? norm(where[2]) : undefined, line: where ? Number(where[1]) : undefined });
    } else if ((m = /^(.*)---line (\d+) of file (.+)$/.exec(l))) {
      issues.push({ level: "error", message: `BibTeX: ${m[1].trim() || lines[i - 1]?.trim() || "syntax error"}`, file: norm(m[3]), line: Number(m[2]) });
    } else if ((m = /^I couldn't open (.*)$/.exec(l)) || (m = /^I found no (.*)$/.exec(l))) {
      issues.push({ level: "error", message: `BibTeX: I couldn't open / found no ${m[1]}` });
    } else if ((m = /^\[\d+\] .*?(ERROR|WARN) - (.*)$/.exec(l))) {
      const lineM = /line (\d+)/.exec(m[2]);
      const fileM = /(?:File|file) '([^']+\.bib)'|([\w./-]+\.bib)/.exec(m[2]);
      issues.push({
        level: m[1] === "ERROR" ? "error" : "warning",
        message: `Biber: ${m[2]}`,
        file: fileM ? norm(path.basename(fileM[1] ?? fileM[2])) : undefined,
        line: lineM ? Number(lineM[1]) : undefined,
      });
    }
  }
  return issues;
}
