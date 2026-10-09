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

export type Engine = "auto" | "pdflatex" | "xelatex" | "lualatex" | "latex" | "tectonic";

export interface LogIssue {
  level: "error" | "warning" | "typesetting";
  message: string;
  file?: string;
  line?: number;
  content?: string;
}

export interface CompileResult {
  status: "success" | "error" | "failure" | "cancelled" | "timeout";
  pdf: boolean;
  engine: Exclude<Engine, "auto">;
  engineSource: "setting" | "magic-comment" | "detected";
  mainFile: string;
  durationMs: number;
  issues: LogIssue[];
  log: string;
  output: string;
  finishedAt: number;
}

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: "" | "low" | "medium" | "high";
  contextChars: number;
  systemPrompt: string;
  /** Last endpoint, key and model per provider. */
  profiles?: Record<string, { baseUrl: string; apiKey: string; model: string }>;
}

export interface AppConfig {
  workspace: string;
  llm: LlmConfig;
  compiler: { engine: Engine; shellEscape: boolean; timeoutSec: number };
  templates: { id: string; name: string; description: string }[];
}

export interface SystemInfo {
  version: string;
  platform: string;
  user: string;
  home: string;
  workspace: string;
  tools: Record<string, string | null>;
  providers: Record<string, { label: string; baseUrl: string }>;
}

export interface ProjectSettings {
  name: string;
  path: string;
  linked: boolean;
  mainFile?: string;
  engine?: Engine;
  shellEscape?: boolean;
  detectedMain: string | null;
}

export interface Symbols {
  labels: { key: string; file: string; line: number; context: string }[];
  citations: { key: string; type: string; title: string; author: string; file: string }[];
  commands: { name: string; args: number }[];
  environments: string[];
}

export interface SyncBox {
  page: number;
  h: number;
  v: number;
  W: number;
  H: number;
}

export interface SearchHit {
  path: string;
  line: number;
  col: number;
  text: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** What the user typed, when `content` also carries attached context. */
  text?: string;
  attachments?: string[];
  reasoning?: string;
  model?: string;
  error?: string;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt?: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (typeof body === "string") {
    init.body = body;
    (init.headers as Record<string, string>)["Content-Type"] = "text/plain; charset=utf-8";
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code: string | undefined;
    try {
      const j = await res.json();
      if (j.error) message = j.error;
      code = j.code;
    } catch {}
    throw new ApiError(res.status, message, code);
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

const P = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
const qp = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();

export const api = {
  system: () => request<SystemInfo>("GET", "/api/system"),
  openPrivacySettings: (pane: "files" | "full-disk") => request("POST", `/api/system/privacy-settings?${qp({ pane })}`),
  config: () => request<AppConfig>("GET", "/api/config"),
  saveConfig: (patch: Partial<Omit<AppConfig, "templates">>) => request<AppConfig>("PUT", "/api/config", patch),

  projects: () => request<Project[]>("GET", "/api/projects"),
  createProject: (name: string, template: string) => request<Project>("POST", "/api/projects", { name, template }),
  importProject: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<Project>("POST", "/api/projects/import", fd);
  },
  linkProject: (path: string) => request<Project>("POST", "/api/projects/link", { path }),
  renameProject: (id: string, name: string) => request<Project>("PATCH", P(id), { name }),
  deleteProject: (id: string) => request<{ ok: boolean; unlinked?: boolean; trashed?: string }>("DELETE", P(id)),
  projectSettings: (id: string) => request<ProjectSettings>("GET", `${P(id)}/settings`),
  saveProjectSettings: (id: string, patch: Partial<Pick<ProjectSettings, "mainFile" | "engine" | "shellEscape">>) =>
    request<ProjectSettings>("PUT", `${P(id)}/settings`, patch),
  reveal: (id: string, path?: string) => request("POST", `${P(id)}/reveal?${qp({ path })}`),
  exportUrl: (id: string) => `${P(id)}/export`,

  tree: (id: string) => request<TreeNode[]>("GET", `${P(id)}/tree`),
  fileUrl: (id: string, path: string, download = false) => `${P(id)}/file?${qp({ path, download: download ? 1 : undefined })}`,
  readFile: (id: string, path: string) => request<string>("GET", `${P(id)}/file?${qp({ path })}`),
  writeFile: (id: string, path: string, content: string) => request<{ ok: boolean; mtime: number }>("PUT", `${P(id)}/file?${qp({ path })}`, content),
  fs: (id: string, op: "mkdir" | "create" | "rename" | "delete", path: string, extra: { to?: string; content?: string } = {}) =>
    request("POST", `${P(id)}/fs`, { op, path, ...extra }),
  upload: (id: string, dir: string, files: File[], relPaths?: string[]) => {
    const fd = new FormData();
    files.forEach((f, i) => {
      fd.append("files", f);
      fd.append("paths", relPaths?.[i] ?? f.name);
    });
    return request<{ files: string[] }>("POST", `${P(id)}/upload?${qp({ dir })}`, fd);
  },
  symbols: (id: string) => request<Symbols>("GET", `${P(id)}/symbols`),
  search: (id: string, q: string, regex: boolean, caseSensitive: boolean) =>
    request<SearchHit[]>("GET", `${P(id)}/search?${qp({ q, regex: regex ? 1 : undefined, case: caseSensitive ? 1 : undefined })}`),

  compile: (id: string, activeFile?: string) => request<CompileResult>("POST", `${P(id)}/compile`, { activeFile }),
  stopCompile: (id: string) => request("POST", `${P(id)}/compile/stop`, {}),
  clearCache: (id: string) => request("DELETE", `${P(id)}/cache`),
  outputUrl: (id: string, name: string, download = false) => `${P(id)}/output/${encodeURIComponent(name)}?${qp({ download: download ? 1 : undefined })}`,
  synctexView: (id: string, file: string, line: number, column = 0) => request<SyncBox[]>("GET", `${P(id)}/synctex/view?${qp({ file, line, column })}`),
  synctexEdit: (id: string, page: number, x: number, y: number) =>
    request<{ file: string; line: number; column: number }>("GET", `${P(id)}/synctex/edit?${qp({ page, x: x.toFixed(2), y: y.toFixed(2) })}`),

  chats: (id: string) => request<Chat[]>("GET", `${P(id)}/chats`),
  saveChat: (id: string, chat: Chat) => request<Chat>("PUT", `${P(id)}/chats/${encodeURIComponent(chat.id)}`, chat),
  deleteChat: (id: string, chatId: string) => request("DELETE", `${P(id)}/chats/${encodeURIComponent(chatId)}`),

  models: (baseUrl?: string, apiKey?: string) => request<{ ok: boolean; models: string[]; error?: string }>("GET", `/api/llm/models?${qp({ baseUrl, apiKey })}`),
  browse: (path?: string) => request<{ path: string; parent: string | null; dirs: string[]; texCount: number }>("GET", `/api/browse?${qp({ path })}`),
};

export function eventsUrl(id: string) {
  return `${P(id)}/events`;
}
