import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { buildDir, clearCache, compileProject, resolveMainFile, stopCompile, synctexEdit, synctexView, toolchain } from "./compile.ts";
import { APP_DIR, CHATS_DIR, ensureDirs, loadConfig, updateConfig, type AppConfig } from "./config.ts";
import { listModels, PROVIDER_PRESETS, proxyChat } from "./llm.ts";
import {
  collectSymbols,
  getProject,
  HttpError,
  isIgnored,
  isTextFile,
  linkProject,
  listProjects,
  moveToTrash,
  permissionError,
  projectId,
  projectSettings,
  readTree,
  resolveIn,
  searchProject,
  setProjectSettings,
  slugify,
  uniqueDir,
  unlinkProject,
  walkFiles,
} from "./projects.ts";
import { templates, welcomeProject } from "./templates.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV = process.argv.includes("--dev");
const PORT = Number(process.env.PORT ?? 4747);
const HOST = process.env.HOST ?? "127.0.0.1";

ensureDirs();
seedWelcomeProject();

const app = express();
app.disable("x-powered-by");
const server = http.createServer(app);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 500 } });

// ---------------------------------------------------------------------------
// Local-only guard: block cross-site requests and DNS-rebinding to this server.
// ---------------------------------------------------------------------------
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
app.use("/api", (req, res, next) => {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) {
    res.status(403).json({ error: "Forbidden host" });
    return;
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      const u = new URL(origin);
      if (!LOCAL_HOSTS.has(u.hostname) || Number(u.port || 80) !== PORT) throw new Error();
    } catch {
      res.status(403).json({ error: "Cross-origin requests are not allowed" });
      return;
    }
  }
  next();
});

app.use("/api", express.json({ limit: "20mb" }));
app.use("/api", express.text({ limit: "50mb", type: ["text/plain"] }));

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
/** Wraps a route: a returned value is sent as JSON unless the handler already responded. */
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res))
    .then((value) => {
      if (value !== undefined && !res.headersSent) res.json(value);
    })
    .catch(next);
};
const param = (req: Request, key: string) => String(req.params[key] ?? "");
const q = (req: Request, key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : "");

// ---------------------------------------------------------------------------
// System & config
// ---------------------------------------------------------------------------
app.get("/api/system", h(() => ({
  version: "0.1.0",
  platform: process.platform,
  user: os.userInfo().username,
  home: os.homedir(),
  workspace: loadConfig().workspace,
  tools: toolchain(),
  providers: PROVIDER_PRESETS,
})));

// Opens the macOS privacy pane where the terminal can be given access to protected folders.
app.post("/api/system/privacy-settings", h((req) => {
  if (process.platform !== "darwin") throw new HttpError(400, "Only available on macOS");
  const pane = q(req, "pane") === "full-disk" ? "Privacy_AllFiles" : "Privacy_FilesAndFolders";
  spawn("open", [`x-apple.systempreferences:com.apple.preference.security?${pane}`], { detached: true, stdio: "ignore" }).unref();
  return { ok: true };
}));

app.get("/api/config", h(() => publicConfig(loadConfig())));

app.put("/api/config", h((req) => {
  const body = req.body as Partial<AppConfig>;
  const next = updateConfig((c) => {
    if (body.llm) c.llm = { ...c.llm, ...body.llm };
    if (body.compiler) c.compiler = { ...c.compiler, ...body.compiler };
    if (typeof body.workspace === "string" && body.workspace.trim()) {
      const ws = path.resolve(body.workspace.trim().replace(/^~(?=$|\/)/, os.homedir()));
      fs.mkdirSync(ws, { recursive: true });
      c.workspace = ws;
    }
  });
  return publicConfig(next);
}));

function publicConfig(c: AppConfig) {
  return { workspace: c.workspace, llm: c.llm, compiler: c.compiler, templates: templates.map(({ id, name, description }) => ({ id, name, description })) };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
app.get("/api/projects", h(() => listProjects()));

app.post("/api/projects", h(async (req) => {
  const { name, template } = req.body as { name?: string; template?: string };
  const tpl = templates.find((t) => t.id === template) ?? templates[0];
  const dir = uniqueDir(loadConfig().workspace, slugify(name || tpl.name));
  await writeFiles(dir, tpl.files);
  const id = projectId(dir);
  if (name && slugify(name) !== name) setProjectSettings(id, { name });
  return getProject(id);
}));

app.post("/api/projects/import", upload.single("file"), h(async (req) => {
  const file = req.file;
  if (!file) throw new HttpError(400, "No file uploaded");
  let zip: AdmZip;
  try {
    zip = new AdmZip(file.buffer);
  } catch {
    throw new HttpError(400, "Not a valid .zip archive");
  }
  const entries = zip.getEntries().filter((e) => !e.entryName.startsWith("__MACOSX/") && !e.entryName.split("/").some((s) => s === ".DS_Store"));
  // Strip a single shared top-level folder (common when zipping a directory).
  const tops = new Set(entries.map((e) => e.entryName.split("/")[0]));
  const strip = tops.size === 1 && entries.every((e) => e.entryName.includes("/")) ? [...tops][0] + "/" : "";
  const baseName = (req.body?.name as string) || file.originalname.replace(/\.zip$/i, "");
  const dir = uniqueDir(loadConfig().workspace, slugify(baseName));
  await fsp.mkdir(dir, { recursive: true });
  for (const e of entries) {
    if (e.isDirectory) continue;
    const rel = e.entryName.slice(strip.length);
    if (!rel) continue;
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(dir + path.sep)) continue; // zip-slip
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, e.getData());
  }
  return getProject(projectId(dir));
}));

app.post("/api/projects/link", h((req) => getProject(linkProject(String((req.body as { path?: string }).path ?? "")))));

app.patch("/api/projects/:id", h(async (req) => {
  const p = getProject(param(req, "id"));
  const { name } = req.body as { name?: string };
  if (!name?.trim()) throw new HttpError(400, "Name is required");
  if (p.linked) {
    setProjectSettings(p.id, { name: name.trim() });
    return getProject(p.id);
  }
  // Workspace projects are folders; renaming moves the folder (and keeps settings).
  const target = uniqueDir(path.dirname(p.path), slugify(name));
  await fsp.rename(p.path, target);
  const newId = projectId(target);
  updateConfig((c) => {
    c.projects[newId] = { ...(c.projects[p.id] ?? {}), name: name.trim() };
    delete c.projects[p.id];
  });
  await clearCache(p.id);
  return getProject(newId);
}));

app.delete("/api/projects/:id", h(async (req) => {
  const p = getProject(param(req, "id"));
  await clearCache(p.id);
  if (p.linked) {
    unlinkProject(p.path);
    return { ok: true, unlinked: true };
  }
  const trashed = await moveToTrash(p.path, "projects");
  updateConfig((c) => {
    delete c.projects[p.id];
  });
  return { ok: true, trashed };
}));

app.get("/api/projects/:id/settings", h(async (req) => {
  const p = getProject(param(req, "id"));
  const s = projectSettings(p.id);
  let detectedMain: string | null = null;
  try {
    detectedMain = await resolveMainFile(p);
  } catch {}
  return { ...s, name: p.name, path: p.path, linked: p.linked, detectedMain };
}));

app.put("/api/projects/:id/settings", h((req) => {
  const p = getProject(param(req, "id"));
  const { mainFile, engine, shellEscape } = req.body as { mainFile?: string; engine?: string; shellEscape?: boolean };
  const patch: Record<string, unknown> = {};
  if (mainFile !== undefined) patch.mainFile = mainFile || undefined;
  if (engine !== undefined) patch.engine = engine || undefined;
  if (shellEscape !== undefined) patch.shellEscape = shellEscape;
  setProjectSettings(p.id, patch);
  return projectSettings(p.id);
}));

app.post("/api/projects/:id/reveal", h((req) => {
  const p = getProject(param(req, "id"));
  const target = q(req, "path") ? resolveIn(p.path, q(req, "path")) : p.path;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const args = process.platform === "darwin" && target !== p.path ? ["-R", target] : [target];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  return { ok: true };
}));

app.get("/api/projects/:id/export", h(async (req, res) => {
  const p = getProject(param(req, "id"));
  const zip = new AdmZip();
  for (const rel of await walkFiles(p.path)) {
    zip.addFile(rel, await fsp.readFile(path.join(p.path, rel)));
  }
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(slugify(p.name))}.zip"`);
  res.end(zip.toBuffer());
}));

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
app.get("/api/projects/:id/tree", h(async (req) => {
  const p = getProject(param(req, "id"));
  return readTree(p.path);
}));

app.get("/api/projects/:id/file", h(async (req, res) => {
  const p = getProject(param(req, "id"));
  const abs = resolveIn(p.path, q(req, "path"));
  const st = await fsp.stat(abs).catch(() => null);
  if (!st?.isFile()) throw new HttpError(404, "File not found");
  res.setHeader("Cache-Control", "no-store");
  if (isTextFile(abs)) res.type("text/plain; charset=utf-8");
  if (q(req, "download")) res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(path.basename(abs))}"`);
  res.sendFile(abs, { dotfiles: "allow" });
}));

app.put("/api/projects/:id/file", h(async (req) => {
  const p = getProject(param(req, "id"));
  const abs = resolveIn(p.path, q(req, "path"));
  if (typeof req.body !== "string") throw new HttpError(400, "Expected text/plain body");
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, req.body, "utf8");
  return { ok: true, mtime: (await fsp.stat(abs)).mtimeMs };
}));

app.post("/api/projects/:id/upload", upload.array("files"), h(async (req) => {
  const p = getProject(param(req, "id"));
  const dir = q(req, "dir");
  const files = (req.files as Express.Multer.File[]) ?? [];
  const relPaths: string[] = [].concat((req.body?.paths as never) ?? []);
  const written: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    // Browsers send latin1-decoded filenames through multipart; recover UTF-8.
    const name = relPaths[i] || Buffer.from(f.originalname, "latin1").toString("utf8");
    const rel = path.posix.join(dir, name);
    const abs = resolveIn(p.path, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, f.buffer);
    written.push(rel);
  }
  return { ok: true, files: written };
}));

app.post("/api/projects/:id/fs", h(async (req) => {
  const p = getProject(param(req, "id"));
  const { op, path: rel, to, content } = req.body as { op: string; path: string; to?: string; content?: string };
  const abs = resolveIn(p.path, rel);
  switch (op) {
    case "mkdir":
      if (fs.existsSync(abs)) throw new HttpError(409, "Already exists");
      await fsp.mkdir(abs, { recursive: true });
      break;
    case "create":
      if (fs.existsSync(abs)) throw new HttpError(409, "A file with that name already exists");
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, content ?? "", "utf8");
      break;
    case "rename": {
      if (!to) throw new HttpError(400, "Missing target");
      const dest = resolveIn(p.path, to);
      if (dest === abs) break;
      if (fs.existsSync(dest)) throw new HttpError(409, "Target already exists");
      if (dest.startsWith(abs + path.sep)) throw new HttpError(400, "Cannot move a folder into itself");
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rename(abs, dest);
      break;
    }
    case "delete":
      if (abs === path.resolve(p.path)) throw new HttpError(400, "Refusing to delete the project root");
      await moveToTrash(abs, `files-${p.id}`);
      break;
    default:
      throw new HttpError(400, "Unknown operation");
  }
  return { ok: true };
}));

app.get("/api/projects/:id/symbols", h(async (req) => collectSymbols(getProject(param(req, "id")).path)));

app.get("/api/projects/:id/search", h(async (req) => {
  const p = getProject(param(req, "id"));
  return searchProject(p.path, q(req, "q"), { regex: q(req, "regex") === "1", caseSensitive: q(req, "case") === "1" });
}));

/** Server-sent events for external file changes (another editor, git checkout, ...). */
app.get("/api/projects/:id/events", h((req, res) => {
  const p = getProject(param(req, "id"));
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(": connected\n\n");
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(p.path, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.toString().split(path.sep).join("/");
      if (rel.split("/").some((seg) => isIgnored(seg))) return;
      pending.add(rel);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        res.write(`data: ${JSON.stringify({ type: "fs", paths: [...pending] })}\n\n`);
        pending = new Set();
      }, 250);
    });
  } catch {}
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    if (timer) clearTimeout(timer);
    watcher?.close();
  });
}));

// ---------------------------------------------------------------------------
// Compile, output & SyncTeX
// ---------------------------------------------------------------------------
app.post("/api/projects/:id/compile", h(async (req) => {
  const p = getProject(param(req, "id"));
  const { activeFile, engine } = (req.body ?? {}) as { activeFile?: string; engine?: string };
  return compileProject(p, { activeFile, engine: engine as never });
}));

app.post("/api/projects/:id/compile/stop", h((req) => ({ stopped: stopCompile(param(req, "id")) })));

app.delete("/api/projects/:id/cache", h(async (req) => {
  await clearCache(getProject(param(req, "id")).id);
  return { ok: true };
}));

app.get("/api/projects/:id/output/:name", h(async (req, res) => {
  const p = getProject(param(req, "id"));
  const name = path.basename(param(req, "name"));
  const abs = path.join(buildDir(p.id), name);
  if (!fs.existsSync(abs)) throw new HttpError(404, "Not compiled yet");
  res.setHeader("Cache-Control", "no-store");
  if (q(req, "download")) {
    const pretty = slugify(p.name) + path.extname(name);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(pretty)}"`);
  }
  res.sendFile(abs, { dotfiles: "allow" });
}));

app.get("/api/projects/:id/synctex/view", h(async (req) => {
  const p = getProject(param(req, "id"));
  return synctexView(p, q(req, "file"), Number(q(req, "line")) || 1, Number(q(req, "column")) || 0);
}));

app.get("/api/projects/:id/synctex/edit", h(async (req) => {
  const p = getProject(param(req, "id"));
  return synctexEdit(p, Number(q(req, "page")) || 1, Number(q(req, "x")) || 0, Number(q(req, "y")) || 0);
}));

// ---------------------------------------------------------------------------
// Chats (stored per project under ~/.latexcompile/chats)
// ---------------------------------------------------------------------------
const chatFile = (id: string) => path.join(CHATS_DIR, `${id.replace(/[^a-z0-9]/gi, "")}.json`);
async function readChats(id: string): Promise<Record<string, unknown>[]> {
  try {
    return JSON.parse(await fsp.readFile(chatFile(id), "utf8"));
  } catch {
    return [];
  }
}
app.get("/api/projects/:id/chats", h(async (req) => readChats(getProject(param(req, "id")).id)));
app.put("/api/projects/:id/chats/:chatId", h(async (req) => {
  const id = getProject(param(req, "id")).id;
  const chats = await readChats(id);
  const chat = { ...(req.body as object), id: param(req, "chatId"), updatedAt: Date.now() };
  const idx = chats.findIndex((c) => c.id === chat.id);
  if (idx >= 0) chats[idx] = chat;
  else chats.unshift(chat);
  await fsp.writeFile(chatFile(id), JSON.stringify(chats.slice(0, 200)));
  return chat;
}));
app.delete("/api/projects/:id/chats/:chatId", h(async (req) => {
  const id = getProject(param(req, "id")).id;
  const chats = (await readChats(id)).filter((c) => c.id !== param(req, "chatId"));
  await fsp.writeFile(chatFile(id), JSON.stringify(chats));
  return { ok: true };
}));

// ---------------------------------------------------------------------------
// LLM proxy
// ---------------------------------------------------------------------------
app.get("/api/llm/models", h(async (req) => listModels({ baseUrl: q(req, "baseUrl") || undefined, apiKey: q(req, "apiKey") || undefined })));
app.post("/api/llm/chat", (req, res, next) => {
  proxyChat(req, res).catch(next);
});

// ---------------------------------------------------------------------------
// Folder browser for "Open folder…"
// ---------------------------------------------------------------------------
app.get("/api/browse", h(async (req) => {
  const dir = path.resolve((q(req, "path") || os.homedir()).replace(/^~(?=$|\/)/, os.homedir()));
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    throw permissionError(err) ?? new HttpError(400, err.code === "ENOENT" ? "Folder not found" : err.code === "ENOTDIR" ? "Not a folder" : "Cannot read folder");
  });
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  const texCount = entries.filter((e) => e.isFile() && e.name.endsWith(".tex")).length;
  return { path: dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), dirs, texCount };
}));

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  err = permissionError(err) ?? err;
  const status = err instanceof HttpError ? err.status : (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error(err);
  if (!res.headersSent) res.status(status).json({ error: message, code: err instanceof HttpError ? err.code : undefined });
  else res.end();
});

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------
// pdf.js runtime assets (CMaps, standard fonts, wasm decoders) used by the viewer.
const PDFJS_DIR = path.join(ROOT, "node_modules", "pdfjs-dist");
for (const sub of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  app.use(`/pdfjs/${sub}`, express.static(path.join(PDFJS_DIR, sub), { maxAge: "7d", fallthrough: false }));
}

async function mountFrontend() {
  const dist = path.join(ROOT, "dist");
  if (!DEV && fs.existsSync(path.join(dist, "index.html"))) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(dist, "index.html"), { dotfiles: "allow" });
    });
    return;
  }
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: ROOT,
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, "utf8");
  }
}

function seedWelcomeProject() {
  const cfg = loadConfig();
  const marker = path.join(APP_DIR, ".seeded");
  if (fs.existsSync(marker)) return;
  try {
    const existing = fs.readdirSync(cfg.workspace).filter((n) => !n.startsWith("."));
    if (existing.length === 0) {
      const dir = path.join(cfg.workspace, "welcome");
      for (const [rel, content] of Object.entries(welcomeProject)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
      }
    }
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString());
  } catch {}
}

await mountFrontend();
server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Open LaTeX Compiler ${DEV ? "(dev) " : ""}running at ${url}`);
  console.log(`  workspace: ${loadConfig().workspace}\n`);
  if (!process.argv.includes("--no-open") && !process.env.NO_OPEN && !DEV) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try {
      spawn(cmd, [url], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
    } catch {}
  }
});
