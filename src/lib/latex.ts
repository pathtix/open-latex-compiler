export interface OutlineItem {
  level: number;
  title: string;
  line: number;
  children: OutlineItem[];
}

const LEVELS: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 };

function stripComment(line: string) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "%") return line.slice(0, i);
  }
  return line;
}

/** Reads a balanced {...} group starting at `start` (which must be "{"). */
function readGroup(text: string, start: number) {
  if (text[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { value: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return { value: text.slice(start + 1), end: text.length };
}

export function cleanTitle(s: string) {
  return s
    .replace(/\\\\/g, " ")
    .replace(/\\(?:label|footnote|cite\w*|ref)\{[^}]*\}/g, "")
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?\{([^{}]*)\}/g, "$2")
    .replace(/\\[a-zA-Z@]+\*?/g, "")
    .replace(/[{}~$]/g, (c) => (c === "~" ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseOutline(text: string): OutlineItem[] {
  const lines = text.split("\n");
  const flat: OutlineItem[] = [];
  const cmdRe = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(\[[^\]]*\])?\s*(?=\{)|\\begin\{frame\}(?:<[^>]*>)?(?:\[[^\]]*\])?\s*(?=\{)|\\frametitle\s*(?=\{)/g;
  for (let i = 0; i < lines.length; i++) {
    const code = stripComment(lines[i]);
    if (!code.includes("\\")) continue;
    cmdRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = cmdRe.exec(code))) {
      const groupStart = m.index + m[0].length;
      // Titles may span lines; read ahead a little.
      const ahead = code.slice(groupStart) + "\n" + lines.slice(i + 1, i + 4).join("\n");
      const g = readGroup(ahead, 0);
      if (!g) continue;
      const level = m[1] ? LEVELS[m[1]] : 3;
      const title = cleanTitle(g.value) || "(untitled)";
      if (m[0].startsWith("\\frametitle")) {
        // Prefer \frametitle over an untitled \begin{frame} on a previous line.
        const prev = flat[flat.length - 1];
        if (prev && prev.title === "(frame)") {
          prev.title = title;
          continue;
        }
      }
      flat.push({ level, title, line: i + 1, children: [] });
    }
    if (/\\begin\{frame\}(?!\s*(?:<[^>]*>)?\s*(?:\[[^\]]*\])?\s*\{)/.test(code)) {
      flat.push({ level: 3, title: "(frame)", line: i + 1, children: [] });
    }
  }
  return nest(flat);
}

function nest(flat: OutlineItem[]): OutlineItem[] {
  const root: OutlineItem[] = [];
  const stack: OutlineItem[] = [];
  for (const item of flat) {
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(item);
    else root.push(item);
    stack.push(item);
  }
  return root;
}

/** The preamble (everything before \begin{document}), trimmed for use as model context. */
export function extractPreamble(text: string, max = 3000) {
  const idx = text.indexOf("\\begin{document}");
  if (idx < 0) return "";
  const pre = text.slice(0, idx);
  return pre.length > max ? pre.slice(0, max) + "\n% …" : pre;
}

export function wordCount(text: string) {
  const body = text.includes("\\begin{document}") ? text.slice(text.indexOf("\\begin{document}")) : text;
  const stripped = body
    .split("\n")
    .map(stripComment)
    .join("\n")
    .replace(/\\begin\{(equation|align|gather|multline|eqnarray|displaymath)\*?\}[\s\S]*?\\end\{\1\*?\}/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, " ")
    .replace(/\\(?:label|ref|eqref|cite\w*|includegraphics|input|include|bibliography\w*|usepackage|documentclass|begin|end)\*?(\[[^\]]*\])?\{[^}]*\}/g, " ")
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    .replace(/[{}[\]&~\\%$#_^]/g, " ");
  return (stripped.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}
