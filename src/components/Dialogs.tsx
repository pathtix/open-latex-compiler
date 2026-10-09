import { ArrowUp, CheckCircle2, CircleAlert, Folder, FolderOpen, Home, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, type AppConfig, type Engine, type LlmConfig } from "../lib/api";
import { flatten, useStore } from "../lib/store";
import { ENGINE_LABELS } from "./PdfPane";
import { Modal, Spinner } from "./ui";

export function DialogHost() {
  const dialog = useStore((s) => s.dialog);
  const close = () => useStore.getState().setDialog(undefined);
  if (!dialog) return null;
  if (dialog.kind === "settings") return <SettingsDialog initialTab={dialog.tab} onClose={close} />;
  if (dialog.kind === "newProject") return <NewProjectDialog onClose={close} />;
  if (dialog.kind === "openFolder") return <OpenFolderDialog onClose={close} />;
  if (dialog.kind === "projectSettings") return <ProjectSettingsDialog onClose={close} />;
  return null;
}

function SettingsDialog({ initialTab, onClose }: { initialTab?: string; onClose: () => void }) {
  const [tab, setTab] = useState(initialTab ?? "general");
  return (
    <Modal title="Settings" onClose={onClose} width={740}>
      <div className="settings">
        <nav className="settings-nav">
          {[
            ["general", "General"],
            ["compiler", "Compiler"],
            ["ai", "AI models"],
          ].map(([id, label]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {tab === "general" && <GeneralSettings />}
          {tab === "compiler" && <CompilerSettings />}
          {tab === "ai" && <AiSettings />}
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <div>{label}</div>
        {hint && <div className="set-hint">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle${value ? " on" : ""}`} onClick={() => onChange(!value)} role="switch" aria-checked={value} />;
}

function GeneralSettings() {
  const prefs = useStore((s) => s.prefs);
  const set = useStore((s) => s.setPrefs);
  const config = useStore((s) => s.config)!;
  const [ws, setWs] = useState(config.workspace);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <Row label="Theme">
        <div className="seg">
          <button className={prefs.theme === "dark" ? "on" : ""} onClick={() => set({ theme: "dark" })}>
            Dark
          </button>
          <button className={prefs.theme === "light" ? "on" : ""} onClick={() => set({ theme: "light" })}>
            Light
          </button>
        </div>
      </Row>
      <Row label="Files panel position">
        <div className="seg">
          <button className={prefs.sidebarSide === "left" ? "on" : ""} onClick={() => set({ sidebarSide: "left" })}>
            Left
          </button>
          <button className={prefs.sidebarSide === "right" ? "on" : ""} onClick={() => set({ sidebarSide: "right" })}>
            Right
          </button>
        </div>
      </Row>
      <Row label="Pane order">
        <div className="seg">
          <button className={!prefs.swapPanes ? "on" : ""} onClick={() => set({ swapPanes: false })}>
            Code | PDF
          </button>
          <button className={prefs.swapPanes ? "on" : ""} onClick={() => set({ swapPanes: true })}>
            PDF | Code
          </button>
        </div>
      </Row>
      <Row label="Editor font size">
        <input className="input narrow" type="number" min={10} max={24} value={prefs.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) || 14 })} />
      </Row>
      <Row label="Word wrap">
        <Toggle value={prefs.wordWrap} onChange={(v) => set({ wordWrap: v })} />
      </Row>
      <Row label="Autosave" hint="Save files shortly after you stop typing">
        <Toggle value={prefs.autosave} onChange={(v) => set({ autosave: v })} />
      </Row>
      <Row label="Auto-compile" hint="Recompile after autosave">
        <Toggle value={prefs.autoCompile} onChange={(v) => set({ autoCompile: v })} />
      </Row>
      <Row label="Workspace folder" hint="New and imported projects are created here">
        <div className="row-gap">
          <input className="input" value={ws} onChange={(e) => (setWs(e.target.value), setSaved(false))} />
          <button
            className="btn"
            disabled={ws === config.workspace}
            onClick={async () => {
              const next = await api.saveConfig({ workspace: ws });
              useStore.getState().setConfig(next);
              await useStore.getState().refreshProjects();
              setWs(next.workspace);
              setSaved(true);
            }}
          >
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </Row>
    </>
  );
}

function CompilerSettings() {
  const config = useStore((s) => s.config)!;
  const system = useStore((s) => s.system)!;
  const save = async (patch: Partial<AppConfig["compiler"]>) => {
    const next = await api.saveConfig({ compiler: { ...config.compiler, ...patch } });
    useStore.getState().setConfig(next);
  };
  return (
    <>
      <Row label="Default compiler" hint="Projects can override this. Auto-detect honours % !TEX program and picks XeLaTeX for fontspec documents.">
        <select className="input" value={config.compiler.engine} onChange={(e) => void save({ engine: e.target.value as Engine })}>
          {(Object.keys(ENGINE_LABELS) as Engine[]).map((e) => (
            <option key={e} value={e}>
              {ENGINE_LABELS[e]}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Shell escape" hint="Needed by minted, svg, gnuplottex. Runs arbitrary commands from documents — enable only for trusted projects.">
        <Toggle value={config.compiler.shellEscape} onChange={(v) => void save({ shellEscape: v })} />
      </Row>
      <Row label="Timeout (seconds)">
        <input className="input narrow" type="number" min={10} max={1800} value={config.compiler.timeoutSec} onChange={(e) => void save({ timeoutSec: Number(e.target.value) || 180 })} />
      </Row>
      <div className="set-subhead">Detected TeX tools</div>
      <div className="tool-grid">
        {Object.entries(system.tools).map(([name, path]) => (
          <div key={name} className="tool-row" title={path ?? "not found"}>
            {path ? <CheckCircle2 size={14} className="ok-text" /> : <CircleAlert size={14} className="muted" />}
            <span className="mono-small">{name}</span>
            <span className="tool-path">{path ?? "not installed"}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function AiSettings() {
  const config = useStore((s) => s.config)!;
  const system = useStore((s) => s.system)!;
  const [llm, setLlm] = useState<LlmConfig>(config.llm);
  const [test, setTest] = useState<{ state: "idle" | "loading" | "ok" | "error"; models: string[]; error?: string }>({ state: "idle", models: [] });
  const [dirty, setDirty] = useState(false);
  const update = (patch: Partial<LlmConfig>) => {
    setLlm((l) => ({ ...l, ...patch }));
    setDirty(true);
  };
  const runTest = async (l = llm) => {
    setTest({ state: "loading", models: [] });
    const r = await api.models(l.baseUrl, l.apiKey).catch((e) => ({ ok: false, models: [], error: e.message }));
    setTest({ state: r.ok ? "ok" : "error", models: r.models, error: r.error });
  };
  useEffect(() => void runTest(config.llm), []);
  const save = async () => {
    const next = await api.saveConfig({ llm });
    useStore.getState().setConfig(next);
    setDirty(false);
  };
  return (
    <>
      <Row label="Provider" hint="Any OpenAI-compatible server works">
        <select
          className="input"
          value={llm.provider}
          onChange={(e) => {
            const preset = system.providers[e.target.value];
            update({ provider: e.target.value, baseUrl: preset?.baseUrl || llm.baseUrl });
          }}
        >
          {Object.entries(system.providers).map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Server URL">
        <div className="row-gap">
          <input className="input mono" value={llm.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} placeholder="http://localhost:1234/v1" />
          <button className="btn" onClick={() => void runTest()}>
            {test.state === "loading" ? <Spinner /> : <RefreshCw size={14} />} Test
          </button>
        </div>
      </Row>
      <div className={`conn-status ${test.state}`}>
        {test.state === "ok" && (
          <>
            <CheckCircle2 size={14} /> Connected — {test.models.length} model{test.models.length === 1 ? "" : "s"} available
          </>
        )}
        {test.state === "error" && (
          <>
            <CircleAlert size={14} /> {test.error}
          </>
        )}
        {test.state === "loading" && "Checking…"}
      </div>
      <Row label="API key" hint="Leave empty for LM Studio / Ollama">
        <input className="input mono" type="password" value={llm.apiKey} onChange={(e) => update({ apiKey: e.target.value })} placeholder="optional" />
      </Row>
      <Row label="Model">
        <select className="input" value={llm.model} onChange={(e) => update({ model: e.target.value })}>
          <option value="">Auto (first available)</option>
          {[...new Set([...(llm.model ? [llm.model] : []), ...test.models])].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Temperature">
        <div className="row-gap">
          <input type="range" min={0} max={1.5} step={0.05} value={llm.temperature} onChange={(e) => update({ temperature: Number(e.target.value) })} />
          <span className="mono-small">{llm.temperature.toFixed(2)}</span>
        </div>
      </Row>
      <Row label="Max output tokens">
        <input className="input narrow" type="number" min={256} max={65536} step={256} value={llm.maxTokens} onChange={(e) => update({ maxTokens: Number(e.target.value) || 4096 })} />
      </Row>
      <Row label="Reasoning effort" hint="Sent as reasoning_effort for models that support it (e.g. gpt-oss)">
        <select className="input" value={llm.reasoningEffort} onChange={(e) => update({ reasoningEffort: e.target.value as LlmConfig["reasoningEffort"] })}>
          <option value="">Model default</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </Row>
      <Row label="File context size" hint="Characters of the open file sent with chat messages">
        <input className="input narrow" type="number" min={1000} max={200000} step={1000} value={llm.contextChars} onChange={(e) => update({ contextChars: Number(e.target.value) || 12000 })} />
      </Row>
      <Row label="Extra instructions" hint="Appended to every AI request (style, language, citation conventions…)">
        <textarea className="input" rows={3} value={llm.systemPrompt} onChange={(e) => update({ systemPrompt: e.target.value })} placeholder="e.g. Use British English. Prefer \cref over \ref." />
      </Row>
      <div className="set-actions">
        <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
          {dirty ? "Save AI settings" : "Saved"}
        </button>
      </div>
    </>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const config = useStore((s) => s.config)!;
  const [name, setName] = useState("");
  const [template, setTemplate] = useState(config.templates[0]?.id ?? "article");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    setBusy(true);
    try {
      const p = await api.createProject(name || config.templates.find((t) => t.id === template)!.name, template);
      const st = useStore.getState();
      await st.refreshProjects();
      onClose();
      await st.openProject(p.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New project"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void create()}>
            {busy ? <Spinner /> : "Create project"}
          </button>
        </>
      }
    >
      <label className="field-label">Name</label>
      <input className="input" autoFocus placeholder="My paper" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
      <label className="field-label">Template</label>
      <div className="template-grid">
        {config.templates.map((t) => (
          <button key={t.id} className={`template${template === t.id ? " active" : ""}`} onClick={() => setTemplate(t.id)}>
            <div className="template-name">{t.name}</div>
            <div className="template-desc">{t.description}</div>
          </button>
        ))}
      </div>
      <div className="set-hint">Created in {config.workspace}</div>
      {error && <div className="field-error">{error}</div>}
    </Modal>
  );
}

function OpenFolderDialog({ onClose }: { onClose: () => void }) {
  const [listing, setListing] = useState<{ path: string; parent: string | null; dirs: string[]; texCount: number } | null>(null);
  const [path, setPath] = useState("");
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => setError({ message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined });
  const go = (p?: string) =>
    api
      .browse(p)
      .then((l) => {
        setListing(l);
        setPath(l.path);
        setError(null);
      })
      .catch(fail);
  useEffect(() => void go(), []);
  const open = async () => {
    setBusy(true);
    try {
      const p = await api.linkProject(path);
      const st = useStore.getState();
      await st.refreshProjects();
      onClose();
      await st.openProject(p.id);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const home = useStore((s) => s.system?.home);
  return (
    <Modal
      title="Open a folder as a project"
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="set-hint grow">{listing ? `${listing.texCount} .tex file${listing.texCount === 1 ? "" : "s"} here` : ""}</span>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !path} onClick={() => void open()}>
            {busy ? <Spinner /> : "Open this folder"}
          </button>
        </>
      }
    >
      <div className="row-gap">
        <button className="icon-btn" title="Home" onClick={() => void go(home)}>
          <Home size={15} />
        </button>
        <button className="icon-btn" title="Up" disabled={!listing?.parent} onClick={() => listing?.parent && void go(listing.parent)}>
          <ArrowUp size={15} />
        </button>
        <input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void go(path)} />
      </div>
      <div className="folder-list">
        {listing?.dirs.map((d) => (
          <button key={d} className="folder-row" onClick={() => void go(`${listing.path}/${d}`)}>
            <Folder size={14} /> {d}
          </button>
        ))}
        {listing && listing.dirs.length === 0 && <div className="empty-hint">No subfolders</div>}
      </div>
      <div className="set-hint">
        <FolderOpen size={12} /> The folder stays where it is; Open LaTeX Compiler edits the files in place and keeps build output in its own cache.
      </div>
      {error && (
        <div className="field-error">
          {error.message}
          {error.code?.startsWith("macos-") && (
            <button className="btn sm privacy-btn" onClick={() => void api.openPrivacySettings(error.code === "macos-full-disk" ? "full-disk" : "files")}>
              Open Privacy Settings
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

function ProjectSettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const tree = useStore((s) => s.tree);
  const config = useStore((s) => s.config)!;
  const st = useStore.getState;
  const texFiles = flatten(tree).filter((n) => n.type === "file" && n.path.endsWith(".tex"));
  if (!settings) return null;
  const save = async (patch: Parameters<ReturnType<typeof st>["saveSettings"]>[0]) => {
    await st().saveSettings(patch);
    void st().compile();
  };
  return (
    <Modal title="Project settings" onClose={onClose} width={540}>
      <Row label="Main document" hint={`Auto-detected: ${settings.detectedMain ?? "none"}. A "% !TEX root = …" line in a file overrides this.`}>
        <select className="input" value={settings.mainFile ?? ""} onChange={(e) => void save({ mainFile: e.target.value })}>
          <option value="">Auto-detect</option>
          {texFiles.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Compiler" hint="A % !TEX program = xelatex line in the main file is used when set to auto-detect.">
        <select className="input" value={settings.engine ?? ""} onChange={(e) => void save({ engine: e.target.value as Engine })}>
          <option value="">Default ({ENGINE_LABELS[config.compiler.engine]})</option>
          {(Object.keys(ENGINE_LABELS) as Engine[]).map((e) => (
            <option key={e} value={e}>
              {ENGINE_LABELS[e]}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Shell escape" hint="Only for projects you trust">
        <Toggle value={settings.shellEscape ?? config.compiler.shellEscape} onChange={(v) => void save({ shellEscape: v })} />
      </Row>
      <Row label="Location">
        <code className="path-code">{settings.path}</code>
      </Row>
    </Modal>
  );
}
