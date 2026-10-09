import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR, loadConfig, type Engine } from "./config.ts";
import { parseBlg, parseTexLog, type LogIssue } from "./logparser.ts";
import { detectMainFile, HttpError, projectSettings, readTree, resolveIn, type Project, type TreeNode } from "./projects.ts";

export type ConcreteEngine = Exclude<Engine, "auto">;

export interface CompileResult {
  status: "success" | "error" | "failure" | "cancelled" | "timeout";
  pdf: boolean;
  engine: ConcreteEngine;
  engineSource: "setting" | "magic-comment" | "detected";
  mainFile: string;
  durationMs: number;
  issues: LogIssue[];
  log: string;
  output: string;
  finishedAt: number;
}

const TEX_PATHS = ["/Library/TeX/texbin", "/usr/texbin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

/** PATH that also covers TeX distributions when launched outside a login shell. */
export function texEnv(): NodeJS.ProcessEnv {
  const parts = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const p of TEX_PATHS) if (!parts.includes(p)) parts.push(p);
  try {
    // TeX Live installs under /usr/local/texlive/<year>/bin/<arch>.
    const tl = "/usr/local/texlive";
    for (const year of fs.readdirSync(tl).sort().reverse()) {
      const bin = path.join(tl, year, "bin");
      if (!fs.existsSync(bin)) continue;
      for (const arch of fs.readdirSync(bin)) parts.push(path.join(bin, arch));
    }
  } catch {}
  return {
    ...process.env,
    PATH: parts.join(path.delimiter),
    max_print_line: "10000",
    error_line: "254",
    half_error_line: "238",
  };
}

export function findExecutable(name: string): string | null {
  const exts = process.platform === "win32" ? [".exe", ".bat", ".cmd", ""] : [""];
  for (const dir of (texEnv().PATH ?? "").split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

export function toolchain() {
  const tools = ["latexmk", "pdflatex", "xelatex", "lualatex", "latex", "dvipdfmx", "tectonic", "bibtex", "biber", "synctex"];
  return Object.fromEntries(tools.map((t) => [t, findExecutable(t)])) as Record<string, string | null>;
}

const MAGIC_PROGRAM_RE = /^\s*%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*([\w-]+)/im;
const MAGIC_ROOT_RE = /^\s*%\s*!\s*TEX\s+root\s*=\s*(.+?)\s*$/im;

function normaliseEngine(name: string): ConcreteEngine | null {
  const n = name.toLowerCase();
  if (n === "xelatex" || n === "xetex") return "xelatex";
  if (n === "lualatex" || n === "luatex" || n === "lualatex-dev") return "lualatex";
  if (n === "pdflatex" || n === "pdftex") return "pdflatex";
  if (n === "latex" || n === "dvipdf" || n === "dvipdfmx") return "latex";
  if (n === "tectonic") return "tectonic";
  return null;
}

async function resolveEngine(setting: Engine, mainAbs: string): Promise<{ engine: ConcreteEngine; source: CompileResult["engineSource"] }> {
  if (setting !== "auto") return { engine: setting, source: "setting" };
  let head = "";
  try {
    head = (await fsp.readFile(mainAbs, "utf8")).slice(0, 20000);
  } catch {}
  const magic = MAGIC_PROGRAM_RE.exec(head.split("\n").slice(0, 30).join("\n"));
  const fromMagic = magic && normaliseEngine(magic[1]);
  if (fromMagic) return { engine: fromMagic, source: "magic-comment" };
  const preamble = head.split(/\\begin\s*\{document\}/)[0].replace(/(^|[^\\])%.*$/gm, "$1");
  if (/\\usepackage(\[[^\]]*\])?\{[^}]*\b(fontspec|unicode-math|polyglossia|xeCJK|xltxtra|xunicode)\b/.test(preamble)) {
    return { engine: /\\usepackage(\[[^\]]*\])?\{[^}]*\b(luacode|luatexja|luaotfload|lua-ul|luamplib)\b/.test(preamble) ? "lualatex" : "xelatex", source: "detected" };
  }
  if (/\\usepackage(\[[^\]]*\])?\{[^}]*\b(luacode|luatexja|luaotfload|lua-ul|luamplib)\b/.test(preamble) || /\\directlua/.test(preamble)) {
    return { engine: "lualatex", source: "detected" };
  }
  return { engine: "pdflatex", source: "detected" };
}

/** Honours `% !TEX root = ...` in the file being edited, then the project setting, then auto-detection. */
export async function resolveMainFile(project: Project, activeFile?: string): Promise<string> {
  if (activeFile && /\.tex$/i.test(activeFile)) {
    try {
      const abs = resolveIn(project.path, activeFile);
      const head = (await fsp.readFile(abs, "utf8")).split("\n").slice(0, 30).join("\n");
      const m = MAGIC_ROOT_RE.exec(head);
      if (m) {
        const target = path.relative(project.path, path.resolve(path.dirname(abs), m[1]));
        if (fs.existsSync(path.join(project.path, target))) return target.split(path.sep).join("/");
      }
    } catch {}
  }
  const s = projectSettings(project.id);
  if (s.mainFile && fs.existsSync(path.join(project.path, s.mainFile))) return s.mainFile;
  const detected = await detectMainFile(project.path);
  if (!detected) throw new HttpError(400, "No .tex file found in this project");
  return detected;
}

export const buildDir = (projectId: string) => path.join(CACHE_DIR, projectId);

const running = new Map<string, { child: ChildProcess; reason?: "cancelled" | "timeout" }>();

export function stopCompile(projectId: string) {
  const r = running.get(projectId);
  if (!r) return false;
  r.reason = "cancelled";
  killTree(r.child);
  return true;
}

function killTree(child: ChildProcess) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
  }, 1500);
}

function run(projectId: string, cmd: string, args: string[], cwd: string, timeoutMs: number, extraEnv: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | null; output: string; reason?: "cancelled" | "timeout" }>((resolve) => {
    let output = "";
    const child = spawn(cmd, args, { cwd, env: { ...texEnv(), ...extraEnv }, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const entry = { child, reason: undefined as "cancelled" | "timeout" | undefined };
    running.set(projectId, entry);
    const onData = (b: Buffer) => {
      if (output.length < 2_000_000) output += b.toString("utf8");
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    const timer = setTimeout(() => {
      entry.reason = "timeout";
      killTree(child);
    }, timeoutMs);
    child.on("error", (err) => {
      output += `\n${err.message}`;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (running.get(projectId) === entry) running.delete(projectId);
      resolve({ code, output, reason: entry.reason });
    });
  });
}

/** TeX cannot create subdirectories in the output dir, which breaks \include{dir/file}. */
async function mirrorDirs(nodes: TreeNode[], srcRoot: string, projectRoot: string, outDir: string) {
  for (const n of nodes) {
    if (n.type !== "dir") continue;
    const relToCwd = path.relative(srcRoot, path.join(projectRoot, n.path));
    if (!relToCwd.startsWith("..")) await fsp.mkdir(path.join(outDir, relToCwd), { recursive: true });
    await mirrorDirs(n.children ?? [], srcRoot, projectRoot, outDir);
  }
}

export interface CompileOptions {
  activeFile?: string;
  engine?: Engine;
}

export async function compileProject(project: Project, opts: CompileOptions = {}): Promise<CompileResult> {
  const started = Date.now();
  const cfg = loadConfig();
  const settings = projectSettings(project.id);
  const mainFile = await resolveMainFile(project, opts.activeFile);
  const mainAbs = resolveIn(project.path, mainFile);
  const cwd = path.dirname(mainAbs);
  const base = path.basename(mainFile).replace(/\.tex$/i, "");
  const { engine, source } = await resolveEngine(opts.engine ?? settings.engine ?? cfg.compiler.engine, mainAbs);
  const outDir = buildDir(project.id);
  // Aux files written by one engine can break another, so switching engines starts clean.
  const stamp = path.join(outDir, ".engine");
  const lastEngine = await fsp.readFile(stamp, "utf8").catch(() => null);
  if (lastEngine && lastEngine !== `${engine}:${mainFile}`) await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(stamp, `${engine}:${mainFile}`);
  await mirrorDirs(await readTree(project.path), cwd, project.path, outDir);

  // A previous compile of the same project is superseded by this one.
  stopCompile(project.id);

  const shellEscape = settings.shellEscape ?? cfg.compiler.shellEscape;
  const timeoutMs = Math.max(10, cfg.compiler.timeoutSec) * 1000;
  const tools = toolchain();
  let result: { code: number | null; output: string; reason?: "cancelled" | "timeout" };

  if (engine === "tectonic") {
    if (!tools.tectonic) throw new HttpError(400, "Tectonic is not installed");
    const args = ["-X", "compile", path.basename(mainAbs), "--outdir", outDir, "--synctex", "--keep-logs", "--keep-intermediates"];
    if (shellEscape) args.push("-Z", "shell-escape");
    result = await run(project.id, tools.tectonic, args, cwd, timeoutMs);
  } else if (tools.latexmk) {
    const modeArgs: Record<Exclude<ConcreteEngine, "tectonic">, string[]> = {
      pdflatex: ["-pdf"],
      xelatex: ["-xelatex"],
      lualatex: ["-lualatex"],
      latex: ["-pdfdvi", "-e", "$dvipdf = 'dvipdfmx %O -o %D %S';"],
    };
    const args = [
      ...modeArgs[engine],
      "-interaction=nonstopmode",
      "-file-line-error",
      "-synctex=1",
      "-f",
      "-recorder",
      `-outdir=${outDir}`,
    ];
    // Without the flag TeX keeps its default restricted shell escape (epstopdf, etc.).
    if (shellEscape) args.push("-shell-escape");
    args.push(path.basename(mainAbs));
    result = await run(project.id, tools.latexmk, args, cwd, timeoutMs);
  } else {
    result = await fallbackCompile(project.id, engine, mainAbs, outDir, shellEscape, timeoutMs, tools);
  }

  const pdfPath = path.join(outDir, `${base}.pdf`);
  const logPath = path.join(outDir, `${base}.log`);
  // When nothing changed latexmk skips the run; the existing outputs (and their log) are still current.
  const upToDate = /Nothing to do for|All targets .* are up-to-date/.test(result.output);
  const isCurrent = async (file: string) => {
    try {
      return upToDate || (await fsp.stat(file)).mtimeMs >= started - 1000;
    } catch {
      return false;
    }
  };
  const log = (await isCurrent(logPath)) ? await fsp.readFile(logPath, "utf8").catch(() => "") : "";
  const issues = log ? parseTexLog(log, project.path, cwd) : [];
  const blgPath = path.join(outDir, `${base}.blg`);
  if (await isCurrent(blgPath)) issues.push(...parseBlg(await fsp.readFile(blgPath, "utf8").catch(() => ""), project.path, cwd));

  const pdfFresh = fs.existsSync(pdfPath) && ((await isCurrent(pdfPath)) || result.code === 0);

  const errors = issues.filter((i) => i.level === "error");
  let status: CompileResult["status"];
  if (result.reason) status = result.reason;
  else if (!pdfFresh) status = "failure";
  else if (errors.length > 0 || result.code !== 0) status = "error";
  else status = "success";

  if (status === "failure" && errors.length === 0) {
    const tail = result.output.trim().split("\n").slice(-12).join("\n");
    issues.unshift({ level: "error", message: log ? "No PDF was produced. See the raw log for details." : "The compiler did not run successfully.", content: tail || undefined });
  }
  if (status === "error" && errors.length === 0 && result.code !== 0 && !upToDate) {
    const tail = result.output.trim().split("\n").slice(-8).join("\n");
    issues.unshift({ level: "warning", message: "The compiler reported a problem (latexmk exit code " + result.code + ").", content: tail || undefined });
  }

  return {
    status,
    pdf: pdfFresh || fs.existsSync(pdfPath),
    engine,
    engineSource: source,
    mainFile,
    durationMs: Date.now() - started,
    issues,
    log,
    output: result.output.slice(-200_000),
    finishedAt: Date.now(),
  };
}

/** Used only when latexmk is missing: engine, bibliography tool, then two more passes. */
async function fallbackCompile(
  projectId: string,
  engine: Exclude<ConcreteEngine, "tectonic">,
  mainAbs: string,
  outDir: string,
  shellEscape: boolean,
  timeoutMs: number,
  tools: Record<string, string | null>,
) {
  const bin = tools[engine];
  if (!bin) throw new HttpError(400, `${engine} is not installed`);
  const cwd = path.dirname(mainAbs);
  const base = path.basename(mainAbs).replace(/\.tex$/i, "");
  const engineArgs = ["-interaction=nonstopmode", "-file-line-error", "-synctex=1", `-output-directory=${outDir}`, ...(shellEscape ? ["-shell-escape"] : []), path.basename(mainAbs)];
  let output = "";
  const pass = async () => {
    const r = await run(projectId, bin, engineArgs, cwd, timeoutMs);
    output += r.output;
    return r;
  };
  let r = await pass();
  if (r.reason) return { ...r, output };
  const aux = await fsp.readFile(path.join(outDir, `${base}.aux`), "utf8").catch(() => "");
  const bcf = fs.existsSync(path.join(outDir, `${base}.bcf`));
  if (bcf && tools.biber) {
    output += (await run(projectId, tools.biber, ["--input-directory", cwd, "--output-directory", outDir, base], cwd, timeoutMs)).output;
  } else if (/\\bibdata/.test(aux) && tools.bibtex) {
    output += (await run(projectId, tools.bibtex, [base], outDir, timeoutMs, { BIBINPUTS: cwd + path.delimiter, BSTINPUTS: cwd + path.delimiter })).output;
  }
  r = await pass();
  if (!r.reason) r = await pass();
  if (engine === "latex" && tools.dvipdfmx && !r.reason) {
    output += (await run(projectId, tools.dvipdfmx, ["-o", `${base}.pdf`, `${base}.dvi`], outDir, timeoutMs)).output;
  }
  return { ...r, output };
}

export async function clearCache(projectId: string) {
  stopCompile(projectId);
  await fsp.rm(buildDir(projectId), { recursive: true, force: true });
}

export interface SyncBox {
  page: number;
  h: number;
  v: number;
  W: number;
  H: number;
}

function parseRecords(out: string) {
  const records: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of out.split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx);
    const val = line.slice(idx + 1);
    if (key === "Output") {
      cur = {};
      records.push(cur);
    } else if (cur) {
      cur[key] = val;
    }
  }
  return records;
}

export async function synctexView(project: Project, file: string, line: number, column: number, activeFile?: string) {
  const tools = toolchain();
  if (!tools.synctex) throw new HttpError(400, "synctex is not installed");
  const mainFile = await resolveMainFile(project, activeFile ?? file);
  const cwd = path.dirname(resolveIn(project.path, mainFile));
  const pdf = path.join(buildDir(project.id), path.basename(mainFile).replace(/\.tex$/i, ".pdf"));
  if (!fs.existsSync(pdf)) throw new HttpError(404, "Compile the project first");
  const input = path.relative(cwd, resolveIn(project.path, file)) || path.basename(file);
  const r = await runSimple(tools.synctex, ["view", "-i", `${line}:${Math.max(0, column)}:${input}`, "-o", pdf], cwd);
  const boxes: SyncBox[] = parseRecords(r)
    .map((rec) => ({ page: Number(rec.Page), h: Number(rec.h), v: Number(rec.v), W: Number(rec.W), H: Number(rec.H) }))
    .filter((b, i, all) => Number.isFinite(b.page) && b.page > 0 && all.findIndex((o) => o.page === b.page && o.h === b.h && o.v === b.v && o.W === b.W) === i);
  if (!boxes.length) throw new HttpError(404, "No matching position in the PDF");
  return boxes;
}

export async function synctexEdit(project: Project, page: number, x: number, y: number) {
  const tools = toolchain();
  if (!tools.synctex) throw new HttpError(400, "synctex is not installed");
  const mainFile = await resolveMainFile(project);
  const cwd = path.dirname(resolveIn(project.path, mainFile));
  const pdf = path.join(buildDir(project.id), path.basename(mainFile).replace(/\.tex$/i, ".pdf"));
  const r = await runSimple(tools.synctex, ["edit", "-o", `${page}:${x}:${y}:${pdf}`], cwd);
  for (const rec of parseRecords(r)) {
    if (!rec.Input) continue;
    const abs = path.resolve(cwd, rec.Input);
    const rel = path.relative(project.path, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    return { file: rel.split(path.sep).join("/"), line: Math.max(1, Number(rec.Line) || 1), column: Math.max(0, Number(rec.Column) || 0) };
  }
  throw new HttpError(404, "No matching source position");
}

function runSimple(cmd: string, args: string[], cwd: string) {
  return new Promise<string>((resolve) => {
    const child = spawn(cmd, args, { cwd, env: texEnv() });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (out += b));
    child.on("error", () => resolve(out));
    child.on("close", () => resolve(out));
  });
}
