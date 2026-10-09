import { create } from "zustand";
import { api, eventsUrl, type AppConfig, type Chat, type CompileResult, type Project, type ProjectSettings, type Symbols, type SystemInfo, type TreeNode } from "./api";

export type DocKind = "text" | "image" | "pdf" | "binary";

export interface OpenDoc {
  path: string;
  kind: DocKind;
  content: string;
  saved: string;
  loading: boolean;
  error?: string;
  /** Bumped when the content is replaced from outside the editor (disk change, reload). */
  extVersion: number;
}

export interface Prefs {
  theme: "dark" | "light";
  sidebarSide: "left" | "right";
  sidebarOpen: boolean;
  sidebarWidth: number;
  editorRatio: number;
  layout: "split" | "editor" | "pdf";
  swapPanes: boolean;
  fontSize: number;
  wordWrap: boolean;
  autosave: boolean;
  autoCompile: boolean;
  pdfDark: boolean;
  outlineOpen: boolean;
  outlineHeight: number;
  chatHeight: number;
  includeFileContext: boolean;
}

const DEFAULT_PREFS: Prefs = {
  theme: "dark",
  sidebarSide: "left",
  sidebarOpen: true,
  sidebarWidth: 280,
  editorRatio: 0.5,
  layout: "split",
  swapPanes: false,
  fontSize: 14,
  wordWrap: true,
  autosave: true,
  autoCompile: true,
  pdfDark: false,
  outlineOpen: true,
  outlineHeight: 240,
  chatHeight: 360,
  includeFileContext: true,
};

const PREFS_KEY = "latexcompile.prefs";
function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

const sessionKey = (id: string) => `latexcompile.session.${id}`;
function loadSession(id: string): { tabs: string[]; active?: string } | null {
  try {
    return JSON.parse(localStorage.getItem(sessionKey(id)) ?? "null");
  } catch {
    return null;
  }
}

export function docKind(path: string): DocKind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["eps", "ps", "zip", "gz", "tgz", "otf", "ttf", "woff", "woff2", "docx", "xlsx", "pptx", "mp4", "mov", "dvi", "xdv"].includes(ext)) return "binary";
  return "text";
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

export type CompileStatus = "idle" | "compiling" | CompileResult["status"];

export interface NavRequest {
  path: string;
  line: number;
  column?: number;
  nonce: number;
}

interface State {
  ready: boolean;
  system?: SystemInfo;
  config?: AppConfig;
  projects: Project[];
  project?: Project;
  settings?: ProjectSettings;
  tree: TreeNode[];
  docs: Record<string, OpenDoc>;
  tabs: string[];
  active?: string;
  nav?: NavRequest;
  compileStatus: CompileStatus;
  compileResult?: CompileResult;
  pdfVersion: number;
  logsOpen: boolean;
  symbols?: Symbols;
  prefs: Prefs;
  dialog?: { kind: "settings"; tab?: string } | { kind: "newProject" } | { kind: "openFolder" } | { kind: "projectSettings" };
  toasts: Toast[];
  chats: Chat[];
  activeChatId?: string;
  chatOpen: boolean;
  sidebarTab: "files" | "chats" | "search";
  pendingChatPrompt?: { text: string; nonce: number };
}

interface Actions {
  init(): Promise<void>;
  refreshProjects(): Promise<void>;
  openProject(id: string, opts?: { push?: boolean }): Promise<void>;
  closeProject(): void;
  refreshTree(): Promise<void>;
  openFile(path: string, nav?: { line: number; column?: number }): Promise<void>;
  closeTab(path: string): void;
  setActive(path: string): void;
  setContent(path: string, content: string): void;
  saveDoc(path: string): Promise<void>;
  saveAll(): Promise<void>;
  reloadDoc(path: string): Promise<void>;
  compile(): Promise<void>;
  stopCompile(): Promise<void>;
  createFile(path: string, content?: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  renamePath(from: string, to: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  uploadFiles(dir: string, files: File[], relPaths?: string[]): Promise<void>;
  setPrefs(patch: Partial<Prefs>): void;
  setDialog(d: State["dialog"]): void;
  toast(text: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
  setConfig(c: AppConfig): void;
  refreshSymbols(): Promise<void>;
  saveSettings(patch: Partial<Pick<ProjectSettings, "mainFile" | "engine" | "shellEscape">>): Promise<void>;
  upsertChat(chat: Chat, persist?: boolean): void;
  deleteChat(id: string): Promise<void>;
  newChat(): void;
  openChat(id?: string): void;
  askInChat(text: string): void;
  goTo(path: string, line: number, column?: number): void;
}

export type Store = State & Actions;

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let compileTimer: ReturnType<typeof setTimeout> | null = null;
let compileQueued = false;
let events: EventSource | null = null;
let treeTimer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;
let initStarted = false;
const COMPILE_TRIGGER = /\.(tex|bib|cls|sty|bst|bbx|cbx|def|cfg|clo|ltx|tikz|csv|dat)$/i;

export const useStore = create<Store>((set, get) => ({
  ready: false,
  projects: [],
  tree: [],
  docs: {},
  tabs: [],
  compileStatus: "idle",
  pdfVersion: 0,
  logsOpen: false,
  prefs: loadPrefs(),
  toasts: [],
  chats: [],
  chatOpen: false,
  sidebarTab: "files",

  async init() {
    if (initStarted) return;
    initStarted = true;
    const [system, config, projects] = await Promise.all([api.system(), api.config(), api.projects()]);
    set({ system, config, projects, ready: true });
    const m = /^\/project\/([^/]+)/.exec(location.pathname);
    if (m && projects.some((p) => p.id === m[1])) await get().openProject(m[1], { push: false });
    window.addEventListener("popstate", () => {
      const mm = /^\/project\/([^/]+)/.exec(location.pathname);
      if (mm) void get().openProject(mm[1], { push: false });
      else get().closeProject();
    });
  },

  async refreshProjects() {
    set({ projects: await api.projects() });
  },

  async openProject(id, opts = {}) {
    const prev = get().project;
    if (prev?.id === id) return;
    if (prev) await get().saveAll();
    events?.close();
    const project = get().projects.find((p) => p.id === id) ?? (await api.projects().then((ps) => (set({ projects: ps }), ps.find((p) => p.id === id))));
    if (!project) {
      get().toast("Project not found", "error");
      return;
    }
    if (opts.push !== false) history.pushState({}, "", `/project/${id}`);
    document.title = `${project.name} · latexcompile`;
    set({
      project,
      tree: [],
      docs: {},
      tabs: [],
      active: undefined,
      compileStatus: "idle",
      compileResult: undefined,
      pdfVersion: 0,
      symbols: undefined,
      chats: [],
      activeChatId: undefined,
      chatOpen: false,
      logsOpen: false,
    });
    const [tree, settings, chats] = await Promise.all([api.tree(id), api.projectSettings(id), api.chats(id).catch(() => [])]);
    // Another project may have been opened while this one was loading.
    if (get().project?.id !== id) return;
    set({ tree, settings, chats });
    const session = loadSession(id);
    const exists = (p: string) => flatten(tree).some((n) => n.path === p);
    const tabs = (session?.tabs ?? []).filter(exists);
    const first = session?.active && exists(session.active) ? session.active : settings.detectedMain ?? tabs[0];
    for (const t of tabs) void get().openFile(t);
    if (first) await get().openFile(first);
    void get().refreshSymbols();
    void get().compile();

    events = new EventSource(eventsUrl(id));
    events.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { type: string; paths: string[] };
        if (msg.type !== "fs") return;
        if (treeTimer) clearTimeout(treeTimer);
        treeTimer = setTimeout(() => void get().refreshTree(), 150);
        for (const p of msg.paths) {
          const d = get().docs[p];
          if (d && d.kind === "text" && d.content === d.saved && !saveTimers.has(p)) void get().reloadDoc(p);
        }
      } catch {}
    };
  },

  closeProject() {
    void get().saveAll();
    events?.close();
    events = null;
    if (location.pathname !== "/") history.pushState({}, "", "/");
    document.title = "latexcompile";
    set({ project: undefined, docs: {}, tabs: [], active: undefined, tree: [], compileResult: undefined, compileStatus: "idle" });
    void get().refreshProjects();
  },

  async refreshTree() {
    const p = get().project;
    if (!p) return;
    const tree = await api.tree(p.id).catch(() => null);
    if (tree && get().project?.id === p.id) set({ tree });
  },

  async openFile(path, nav) {
    const p = get().project;
    if (!p) return;
    const { docs, tabs } = get();
    if (!tabs.includes(path)) set({ tabs: [...tabs, path] });
    set({ active: path });
    if (nav) set({ nav: { path, line: nav.line, column: nav.column, nonce: Date.now() } });
    persistSession(get());
    if (docs[path]) return;
    const kind = docKind(path);
    set((s) => ({ docs: { ...s.docs, [path]: { path, kind, content: "", saved: "", loading: kind === "text", extVersion: 0 } } }));
    if (kind !== "text") return;
    try {
      const text = await api.readFile(p.id, path);
      set((s) => ({ docs: { ...s.docs, [path]: { ...s.docs[path], content: text, saved: text, loading: false, extVersion: (s.docs[path]?.extVersion ?? 0) + 1 } } }));
      if (nav) set({ nav: { path, line: nav.line, column: nav.column, nonce: Date.now() } });
    } catch (e) {
      set((s) => ({ docs: { ...s.docs, [path]: { ...s.docs[path], loading: false, error: (e as Error).message } } }));
    }
  },

  closeTab(path) {
    const d = get().docs[path];
    if (d && d.content !== d.saved) void get().saveDoc(path);
    const tabs = get().tabs.filter((t) => t !== path);
    const docs = { ...get().docs };
    delete docs[path];
    let active = get().active;
    if (active === path) {
      const idx = get().tabs.indexOf(path);
      active = tabs[Math.min(idx, tabs.length - 1)];
    }
    set({ tabs, docs, active });
    persistSession(get());
  },

  setActive(path) {
    set({ active: path });
    persistSession(get());
  },

  setContent(path, content) {
    const d = get().docs[path];
    if (!d || d.content === content) return;
    set((s) => ({ docs: { ...s.docs, [path]: { ...s.docs[path], content } } }));
    if (get().prefs.autosave) {
      clearTimeout(saveTimers.get(path));
      saveTimers.set(
        path,
        setTimeout(() => {
          saveTimers.delete(path);
          void get().saveDoc(path).then(() => {
            if (get().prefs.autoCompile && COMPILE_TRIGGER.test(path)) scheduleCompile(get, 600);
          });
        }, 700),
      );
    }
  },

  async saveDoc(path) {
    const p = get().project;
    const d = get().docs[path];
    if (!p || !d || d.kind !== "text" || d.content === d.saved) return;
    clearTimeout(saveTimers.get(path));
    saveTimers.delete(path);
    const content = d.content;
    try {
      await api.writeFile(p.id, path, content);
      set((s) => (s.docs[path] ? { docs: { ...s.docs, [path]: { ...s.docs[path], saved: content } } } : {}));
    } catch (e) {
      get().toast(`Could not save ${path}: ${(e as Error).message}`, "error");
    }
  },

  async saveAll() {
    await Promise.all(Object.keys(get().docs).map((p) => get().saveDoc(p)));
  },

  async reloadDoc(path) {
    const p = get().project;
    if (!p) return;
    try {
      const text = await api.readFile(p.id, path);
      const d = get().docs[path];
      if (!d || d.content !== d.saved || text === d.content) return;
      set((s) => ({ docs: { ...s.docs, [path]: { ...s.docs[path], content: text, saved: text, extVersion: d.extVersion + 1 } } }));
    } catch {}
  },

  async compile() {
    const p = get().project;
    if (!p) return;
    if (compileTimer) {
      clearTimeout(compileTimer);
      compileTimer = null;
    }
    if (get().compileStatus === "compiling") {
      compileQueued = true;
      return;
    }
    await get().saveAll();
    set({ compileStatus: "compiling" });
    try {
      const active = get().active;
      const result = await api.compile(p.id, active && docKind(active) === "text" ? active : undefined);
      if (get().project?.id !== p.id) return;
      set((s) => ({
        compileResult: result,
        compileStatus: result.status,
        pdfVersion: result.pdf && result.status !== "cancelled" ? s.pdfVersion + 1 : s.pdfVersion,
        logsOpen: s.logsOpen || (result.status === "failure" && !s.compileResult),
      }));
      void get().refreshSymbols();
    } catch (e) {
      set({ compileStatus: "failure" });
      get().toast(`Compile failed: ${(e as Error).message}`, "error");
    }
    if (compileQueued) {
      compileQueued = false;
      void get().compile();
    }
  },

  async stopCompile() {
    const p = get().project;
    compileQueued = false;
    if (p) await api.stopCompile(p.id).catch(() => {});
  },

  async createFile(path, content = "") {
    const p = get().project!;
    await api.fs(p.id, "create", path, { content });
    await get().refreshTree();
    await get().openFile(path);
  },

  async createFolder(path) {
    await api.fs(get().project!.id, "mkdir", path);
    await get().refreshTree();
  },

  async renamePath(from, to) {
    const p = get().project!;
    await get().saveAll();
    await api.fs(p.id, "rename", from, { to });
    // Re-key open documents under the renamed path.
    const remap = (x: string) => (x === from ? to : x.startsWith(from + "/") ? to + x.slice(from.length) : x);
    set((s) => {
      const docs: Record<string, OpenDoc> = {};
      for (const [k, v] of Object.entries(s.docs)) docs[remap(k)] = { ...v, path: remap(k) };
      return { docs, tabs: s.tabs.map(remap), active: s.active ? remap(s.active) : s.active };
    });
    persistSession(get());
    await get().refreshTree();
  },

  async deletePath(path) {
    const p = get().project!;
    await api.fs(p.id, "delete", path);
    for (const t of get().tabs) if (t === path || t.startsWith(path + "/")) get().closeTab(t);
    await get().refreshTree();
  },

  async uploadFiles(dir, files, relPaths) {
    const p = get().project!;
    try {
      const r = await api.upload(p.id, dir, files, relPaths);
      await get().refreshTree();
      for (const f of r.files) if (get().docs[f]) await get().reloadDoc(f);
      get().toast(`Uploaded ${r.files.length} file${r.files.length === 1 ? "" : "s"}`, "success");
    } catch (e) {
      get().toast(`Upload failed: ${(e as Error).message}`, "error");
    }
  },

  setPrefs(patch) {
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  },

  setDialog(dialog) {
    set({ dialog });
  },

  toast(text, kind = "info") {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3500);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setConfig(config) {
    set({ config });
  },

  async refreshSymbols() {
    const p = get().project;
    if (!p) return;
    const symbols = await api.symbols(p.id).catch(() => undefined);
    if (symbols && get().project?.id === p.id) set({ symbols });
  },

  async saveSettings(patch) {
    const p = get().project!;
    await api.saveProjectSettings(p.id, patch);
    set({ settings: await api.projectSettings(p.id) });
  },

  upsertChat(chat, persist = true) {
    set((s) => {
      const idx = s.chats.findIndex((c) => c.id === chat.id);
      const chats = idx >= 0 ? s.chats.map((c) => (c.id === chat.id ? chat : c)) : [chat, ...s.chats];
      return { chats };
    });
    const p = get().project;
    if (persist && p) void api.saveChat(p.id, chat).catch(() => {});
  },

  async deleteChat(id) {
    const p = get().project;
    set((s) => ({ chats: s.chats.filter((c) => c.id !== id), activeChatId: s.activeChatId === id ? undefined : s.activeChatId }));
    if (p) await api.deleteChat(p.id, id).catch(() => {});
  },

  newChat() {
    set({ activeChatId: undefined, chatOpen: true });
  },

  openChat(id) {
    set({ activeChatId: id, chatOpen: true });
  },

  askInChat(text) {
    set({ chatOpen: true, activeChatId: undefined, pendingChatPrompt: { text, nonce: Date.now() } });
  },

  goTo(path, line, column) {
    void get().openFile(path, { line, column });
  },
}));

function scheduleCompile(get: () => Store, delay: number) {
  if (compileTimer) clearTimeout(compileTimer);
  compileTimer = setTimeout(() => {
    compileTimer = null;
    void get().compile();
  }, delay);
}

function persistSession(s: State) {
  if (!s.project) return;
  try {
    localStorage.setItem(sessionKey(s.project.id), JSON.stringify({ tabs: s.tabs, active: s.active }));
  } catch {}
}

export function flatten(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
