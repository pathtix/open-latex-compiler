import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Engine = "auto" | "pdflatex" | "xelatex" | "lualatex" | "latex" | "tectonic";

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
}

export interface CompilerDefaults {
  engine: Engine;
  shellEscape: boolean;
  timeoutSec: number;
}

export interface ProjectSettings {
  name?: string;
  mainFile?: string;
  engine?: Engine;
  shellEscape?: boolean;
}

export interface AppConfig {
  workspace: string;
  linked: string[];
  llm: LlmConfig;
  compiler: CompilerDefaults;
  projects: Record<string, ProjectSettings>;
}

export const APP_DIR = process.env.LATEXCOMPILE_HOME ?? path.join(os.homedir(), ".latexcompile");
export const CACHE_DIR = path.join(APP_DIR, "cache");
export const TRASH_DIR = path.join(APP_DIR, "trash");
export const CHATS_DIR = path.join(APP_DIR, "chats");
const CONFIG_FILE = path.join(APP_DIR, "config.json");

const defaults = (): AppConfig => ({
  workspace: process.env.LATEXCOMPILE_WORKSPACE ?? path.join(os.homedir(), "LatexCompile"),
  linked: [],
  llm: {
    provider: "lmstudio",
    baseUrl: "http://localhost:1234/v1",
    apiKey: "",
    model: "",
    temperature: 0.4,
    maxTokens: 4096,
    reasoningEffort: "",
    contextChars: 12000,
    systemPrompt: "",
  },
  compiler: {
    engine: "auto",
    shellEscape: false,
    timeoutSec: 180,
  },
  projects: {},
});

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const base = defaults();
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    cached = {
      ...base,
      ...raw,
      llm: { ...base.llm, ...(raw.llm ?? {}) },
      compiler: { ...base.compiler, ...(raw.compiler ?? {}) },
      projects: raw.projects ?? {},
      linked: Array.isArray(raw.linked) ? raw.linked : [],
    };
  } catch {
    cached = base;
  }
  return cached!;
}

export function saveConfig(next: AppConfig) {
  cached = next;
  fs.mkdirSync(APP_DIR, { recursive: true });
  const tmp = CONFIG_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
}

export function updateConfig(fn: (c: AppConfig) => void) {
  const c = structuredClone(loadConfig());
  fn(c);
  saveConfig(c);
  return c;
}

export function ensureDirs() {
  const c = loadConfig();
  for (const d of [APP_DIR, CACHE_DIR, TRASH_DIR, CHATS_DIR, c.workspace]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
