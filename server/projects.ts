import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, TRASH_DIR, updateConfig, type ProjectSettings } from "./config.ts";

export interface Project {
  id: string;
  name: string;
  path: string;
  linked: boolean;
  modified: number;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: TreeNode[];
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const TERMINALS: Record<string, string> = { WarpTerminal: "Warp", Apple_Terminal: "Terminal", "iTerm.app": "iTerm", vscode: "VS Code", ghostty: "Ghostty", WezTerm: "WezTerm" };
const PROTECTED = ["Desktop", "Documents", "Downloads"];

/**
 * Turns EPERM/EACCES into an actionable message. On macOS, EPERM usually comes from the
 * privacy protection on Desktop, Documents, Downloads and external volumes, which applies
 * to the app that started Open LaTeX Compiler (the terminal), not to Open LaTeX Compiler itself.
 */
export function permissionError(err: unknown): HttpError | null {
  const { code, path: target } = (err ?? {}) as NodeJS.ErrnoException;
  if (code !== "EPERM" && code !== "EACCES") return null;
  const what = target ? `“${path.basename(target)}”` : "this folder";
  if (process.platform !== "darwin" || code === "EACCES") return new HttpError(403, `Permission denied: cannot access ${what}.`, "permission");
  // The desktop app asks for access itself; from a terminal, the terminal app is the one that needs it.
  const desktop = !!process.env.LATEXCOMPILE_DESKTOP;
  const app = desktop ? "Open LaTeX Compiler" : TERMINALS[process.env.TERM_PROGRAM ?? ""] ?? "the app that started Open LaTeX Compiler";
  const top = target ? path.relative(os.homedir(), target).split(path.sep)[0] : "";
  const fix = PROTECTED.includes(top)
    ? `turn on “${top} Folder” for ${app} in System Settings → Privacy & Security → Files & Folders`
    : `give ${app} Full Disk Access in System Settings → Privacy & Security`;
  const restart = desktop
    ? "then quit Open LaTeX Compiler (⌘Q) and open it again."
    : `then quit ${app} (⌘Q), reopen it and start Open LaTeX Compiler again. If it is already on, ${app} probably updated itself while running, which suspends its permissions until it restarts.`;
  return new HttpError(403, `macOS blocked access to ${what}. To allow it, ${fix}, ${restart}`, PROTECTED.includes(top) ? "macos-files" : "macos-full-disk");
}

/** Names that never show up in the file tree, search or exports. */
const IGNORED = new Set([".git", ".svn", ".hg", "node_modules", ".DS_Store", ".latexcompile", "__MACOSX", ".idea", ".vscode"]);
export const isIgnored = (name: string) => IGNORED.has(name);

export const TEXT_EXTS = new Set([
  "tex", "bib", "cls", "sty", "bst", "bbx", "cbx", "lbx", "def", "cfg", "clo", "ltx", "dtx", "ins", "txt", "md",
  "csv", "tsv", "json", "yaml", "yml", "lua", "py", "r", "m", "sh", "tikz", "pgf", "dat", "latexmkrc", "gitignore",
  "bbl", "log", "toml", "xml", "html", "css", "js", "ts", "mk", "makefile", "rnw", "rtex", "asy", "gp", "plt",
]);

export function isTextFile(file: string) {
  const base = path.basename(file).toLowerCase();
  if (base === "makefile" || base === "latexmkrc" || base === ".latexmkrc" || base === "readme") return true;
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return TEXT_EXTS.has(ext);
}

export const projectId = (absPath: string) =>
  crypto.createHash("sha1").update(path.resolve(absPath)).digest("hex").slice(0, 12);

function projectFromDir(dir: string, linked: boolean): Project | null {
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return null;
    const id = projectId(dir);
    const settings = loadConfig().projects[id];
    return {
      id,
      name: settings?.name || path.basename(dir),
      path: dir,
      linked,
      modified: latestMtime(dir, st.mtimeMs),
    };
  } catch {
    return null;
  }
}

/** Newest mtime of top-level entries; cheap stand-in for "last edited". */
function latestMtime(dir: string, fallback: number) {
  let latest = fallback;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (isIgnored(name)) continue;
      const m = fs.statSync(path.join(dir, name)).mtimeMs;
      if (m > latest) latest = m;
    }
  } catch {}
  return latest;
}

export function listProjects(): Project[] {
  const cfg = loadConfig();
  const out: Project[] = [];
  try {
    for (const name of fs.readdirSync(cfg.workspace)) {
      if (name.startsWith(".") || isIgnored(name)) continue;
      const p = projectFromDir(path.join(cfg.workspace, name), false);
      if (p) out.push(p);
    }
  } catch {}
  for (const dir of cfg.linked) {
    const p = projectFromDir(dir, true);
    if (p) out.push(p);
  }
  return out.sort((a, b) => b.modified - a.modified);
}

export function getProject(id: string): Project {
  const p = listProjects().find((x) => x.id === id);
  if (!p) throw new HttpError(404, "Project not found");
  return p;
}

export function projectSettings(id: string): ProjectSettings {
  return loadConfig().projects[id] ?? {};
}

export function setProjectSettings(id: string, patch: ProjectSettings) {
  updateConfig((c) => {
    c.projects[id] = { ...(c.projects[id] ?? {}), ...patch };
  });
}

/** Resolves a project-relative path, refusing anything that escapes the project root. */
export function resolveIn(root: string, rel: string) {
  const clean = (rel ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.resolve(root, clean);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    throw new HttpError(400, "Path escapes project");
  }
  if (clean.split("/").some((seg) => isIgnored(seg))) throw new HttpError(400, "Path is not accessible");
  // Symlinks inside a project may not point outside it.
  try {
    const real = fs.realpathSync(abs);
    const realRoot = fs.realpathSync(rootResolved);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new HttpError(400, "Path escapes project");
  } catch (e) {
    if (e instanceof HttpError) throw e;
  }
  return abs;
}

export const toRel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join("/");

export async function readTree(root: string, dir = root, depth = 0): Promise<TreeNode[]> {
  if (depth > 12) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    if (isIgnored(e.name)) continue;
    const abs = path.join(dir, e.name);
    const rel = toRel(root, abs);
    if (e.isDirectory()) {
      nodes.push({ name: e.name, path: rel, type: "dir", children: await readTree(root, abs, depth + 1) });
    } else if (e.isFile() || e.isSymbolicLink()) {
      let size = 0;
      try {
        size = (await fsp.stat(abs)).size;
      } catch {}
      nodes.push({ name: e.name, path: rel, type: "file", size });
    }
  }
  return nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "dir" ? -1 : 1));
}

export async function walkFiles(root: string, filter?: (rel: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const visit = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.type === "dir") visit(n.children ?? []);
      else if (!filter || filter(n.path)) out.push(n.path);
    }
  };
  visit(await readTree(root));
  return out;
}

/** Moves a file or folder into the app trash instead of deleting it outright. */
export async function moveToTrash(abs: string, label: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(TRASH_DIR, label, stamp, path.basename(abs));
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.rename(abs, dest);
  } catch {
    await fsp.cp(abs, dest, { recursive: true });
    await fsp.rm(abs, { recursive: true, force: true });
  }
  return dest;
}

export function slugify(name: string) {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return s || "untitled";
}

export function uniqueDir(parent: string, base: string) {
  let candidate = path.join(parent, base);
  let i = 2;
  while (fs.existsSync(candidate)) candidate = path.join(parent, `${base}-${i++}`);
  return candidate;
}

/** Guess the root document: main.tex, else a .tex file with \documentclass near its top. */
export async function detectMainFile(root: string): Promise<string | null> {
  const texFiles = await walkFiles(root, (p) => p.toLowerCase().endsWith(".tex"));
  const hasClass = async (rel: string) => {
    try {
      const head = (await fsp.readFile(path.join(root, rel), "utf8")).slice(0, 8000);
      return /^[^%\n]*\\documentclass/m.test(head);
    } catch {
      return false;
    }
  };
  const preferred = ["main.tex", "paper.tex", "thesis.tex", "report.tex", "document.tex", "article.tex"];
  for (const name of preferred) if (texFiles.includes(name) && (await hasClass(name))) return name;
  const shallowFirst = [...texFiles].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  for (const f of shallowFirst) if (await hasClass(f)) return f;
  return texFiles[0] ?? null;
}

export interface Symbols {
  labels: { key: string; file: string; line: number; context: string }[];
  citations: { key: string; type: string; title: string; author: string; file: string }[];
  commands: { name: string; args: number }[];
  environments: string[];
}

export async function collectSymbols(root: string): Promise<Symbols> {
  const files = await walkFiles(root, (p) => /\.(tex|bib|sty|cls)$/i.test(p));
  const sym: Symbols = { labels: [], citations: [], commands: [], environments: [] };
  const envs = new Set<string>();
  for (const rel of files.slice(0, 400)) {
    let text: string;
    try {
      text = await fsp.readFile(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (text.length > 4_000_000) continue;
    if (rel.toLowerCase().endsWith(".bib")) {
      const entry = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
      let m: RegExpExecArray | null;
      while ((m = entry.exec(text))) {
        const type = m[1].toLowerCase();
        if (type === "string" || type === "comment" || type === "preamble") continue;
        const body = text.slice(m.index, m.index + 3000);
        const field = (name: string) => {
          const f = new RegExp(`\\b${name}\\s*=\\s*[{"]([^]*?)[}"]\\s*,?\\s*\\n`, "i").exec(body);
          return f ? f[1].replace(/[{}]/g, "").replace(/\s+/g, " ").trim() : "";
        };
        sym.citations.push({ key: m[2], type, title: field("title"), author: field("author"), file: rel });
      }
      continue;
    }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const code = stripComment(line);
      for (const m of code.matchAll(/\\label\{([^}]+)\}/g)) {
        sym.labels.push({ key: m[1], file: rel, line: i + 1, context: code.trim().slice(0, 120) });
      }
      for (const m of code.matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[(\d)\])?/g)) {
        sym.commands.push({ name: m[1], args: m[2] ? Number(m[2]) : 0 });
      }
      for (const m of code.matchAll(/\\(?:DeclareMathOperator|def)\*?\s*\{?\\([a-zA-Z@]+)/g)) {
        sym.commands.push({ name: m[1], args: 0 });
      }
      for (const m of code.matchAll(/\\(?:re)?newenvironment\*?\s*\{([^}]+)\}/g)) envs.add(m[1]);
      for (const m of code.matchAll(/\\begin\{([^}]+)\}/g)) envs.add(m[1]);
    });
  }
  sym.environments = [...envs];
  return sym;
}

export function stripComment(line: string) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "%") return line.slice(0, i);
  }
  return line;
}

export interface SearchHit {
  path: string;
  line: number;
  col: number;
  text: string;
}

export async function searchProject(root: string, query: string, opts: { regex?: boolean; caseSensitive?: boolean }) {
  if (!query) return [];
  let re: RegExp;
  try {
    re = opts.regex
      ? new RegExp(query, opts.caseSensitive ? "g" : "gi")
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), opts.caseSensitive ? "g" : "gi");
  } catch {
    throw new HttpError(400, "Invalid regular expression");
  }
  const hits: SearchHit[] = [];
  const files = await walkFiles(root, (p) => isTextFile(p) && !/\.(log|bbl)$/i.test(p));
  for (const rel of files) {
    let text: string;
    try {
      const st = await fsp.stat(path.join(root, rel));
      if (st.size > 2_000_000) continue;
      text = await fsp.readFile(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      const m = re.exec(lines[i]);
      if (m) {
        hits.push({ path: rel, line: i + 1, col: m.index, text: lines[i].slice(0, 300) });
        if (hits.length >= 500) return hits;
      }
    }
  }
  return hits;
}

export function linkProject(dir: string) {
  const abs = path.resolve(dir.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  try {
    if (!fs.statSync(abs).isDirectory()) throw new HttpError(400, "Not a folder");
    fs.readdirSync(abs);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw permissionError(err) ?? new HttpError(400, "Folder does not exist");
  }
  const cfg = loadConfig();
  const inWorkspace = path.dirname(abs) === path.resolve(cfg.workspace);
  if (!inWorkspace && !cfg.linked.includes(abs)) {
    updateConfig((c) => {
      c.linked.push(abs);
    });
  }
  return projectId(abs);
}

export function unlinkProject(abs: string) {
  updateConfig((c) => {
    c.linked = c.linked.filter((d) => path.resolve(d) !== path.resolve(abs));
  });
}

export function settingsFor(p: Project): ProjectSettings & { name: string } {
  return { ...projectSettings(p.id), name: p.name };
}
