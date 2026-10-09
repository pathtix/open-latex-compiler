import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Columns2,
  Contrast,
  Download,
  ExternalLink,
  FileText,
  Maximize2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Play,
  RefreshCw,
  ScrollText,
  Sparkles,
  Square,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { editorBridge } from "../editor/bridge";
import { api, type Engine, type LogIssue } from "../lib/api";
import { useStore } from "../lib/store";
import { PdfViewerView, type PdfViewerHandle } from "../pdf/PdfViewer";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Spinner, mod } from "./ui";

export const ENGINE_LABELS: Record<Engine, string> = {
  auto: "Auto-detect",
  pdflatex: "pdfLaTeX",
  xelatex: "XeLaTeX",
  lualatex: "LuaLaTeX",
  latex: "LaTeX → DVI → PDF",
  tectonic: "Tectonic",
};
const ENGINE_TOOL: Record<Engine, string> = { auto: "latexmk", pdflatex: "pdflatex", xelatex: "xelatex", lualatex: "lualatex", latex: "latex", tectonic: "tectonic" };

const ZOOMS: [string, string][] = [
  ["page-width", "Fit width"],
  ["page-fit", "Fit page"],
  ["auto", "Automatic"],
  ["0.5", "50%"],
  ["0.75", "75%"],
  ["1", "100%"],
  ["1.25", "125%"],
  ["1.5", "150%"],
  ["2", "200%"],
  ["3", "300%"],
];

export function PdfPane() {
  const project = useStore((s) => s.project)!;
  const result = useStore((s) => s.compileResult);
  const status = useStore((s) => s.compileStatus);
  const pdfVersion = useStore((s) => s.pdfVersion);
  const logsOpen = useStore((s) => s.logsOpen);
  const pdfDark = useStore((s) => s.prefs.pdfDark);
  const viewer = useRef<PdfViewerHandle>(null);
  const [pages, setPages] = useState({ page: 0, pages: 0 });
  const [scale, setScale] = useState({ scale: 1, value: "page-width" });
  const [pageInput, setPageInput] = useState<string | null>(null);

  const pdfName = result ? result.mainFile.split("/").pop()!.replace(/\.tex$/i, ".pdf") : null;
  const url = pdfVersion > 0 && pdfName ? `${api.outputUrl(project.id, pdfName)}&v=${pdfVersion}` : null;

  const goToPdf = async () => {
    const path = editorBridge.path;
    const cur = editorBridge.cursor();
    if (!path || !cur) return useStore.getState().toast("Place the cursor in a .tex file first");
    try {
      const boxes = await api.synctexView(project.id, path, cur.line, cur.column);
      viewer.current?.showBoxes(boxes);
    } catch (e) {
      useStore.getState().toast((e as Error).message, "error");
    }
  };

  const goToCode = async (page?: number, x?: number, y?: number) => {
    let p = page;
    let px = x;
    let py = y;
    if (p === undefined) {
      const c = viewer.current?.centerPoint();
      if (!c) return;
      ({ page: p, x: px, y: py } = c);
    }
    try {
      const loc = await api.synctexEdit(project.id, p!, px!, py!);
      useStore.getState().goTo(loc.file, loc.line);
    } catch (e) {
      useStore.getState().toast((e as Error).message, "error");
    }
  };

  const zoomLabel = ZOOMS.find(([v]) => v === scale.value)?.[1] ?? `${Math.round(scale.scale * 100)}%`;

  return (
    <section className={`pdf-pane${pdfDark ? " pdf-dark" : ""}`}>
      <div className="pane-header pdf-header">
        <CompileButton />
        <div className="grow" />
        {pages.pages > 0 && (
          <div className="page-indicator">
            <input
              value={pageInput ?? String(pages.page).padStart(2, "0")}
              onFocus={(e) => (setPageInput(String(pages.page)), requestAnimationFrame(() => e.target.select()))}
              onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
              onBlur={() => setPageInput(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  viewer.current?.goToPage(Number(pageInput));
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            <span className="muted">of {pages.pages}</span>
          </div>
        )}
        <Menu
          align="end"
          trigger={({ toggle }) => (
            <button className="hdr-btn" onClick={toggle} disabled={!url}>
              <Maximize2 size={14} /> {zoomLabel} <ChevronDown size={13} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={<ZoomIn size={14} />} label="Zoom in" hint={`${mod}+ / ${mod}scroll`} onClick={() => viewer.current?.zoomIn()} />
              <MenuItem icon={<ZoomOut size={14} />} label="Zoom out" onClick={() => viewer.current?.zoomOut()} />
              <MenuSeparator />
              {ZOOMS.map(([v, label]) => (
                <MenuItem key={v} checked={scale.value === v} label={label} onClick={() => (close(), viewer.current?.setScale(v))} />
              ))}
            </>
          )}
        </Menu>
        <a className={`icon-btn${url ? "" : " disabled"}`} title="Download PDF" href={url && pdfName ? api.outputUrl(project.id, pdfName, true) : undefined}>
          <Download size={16} />
        </a>
        <PdfMoreMenu url={url} />
      </div>

      <div className="pdf-body">
        <PdfViewerView
          ref={viewer}
          url={url}
          onPages={setPages}
          onScale={setScale}
          onInverseSearch={(p, x, y) => void goToCode(p, x, y)}
          onError={(m) => useStore.getState().toast(`PDF: ${m}`, "error")}
        />
        {!url && <PdfPlaceholder status={status} />}
        {url && (
          <div className="pdf-pill">
            <button title="Zoom out" onClick={() => viewer.current?.zoomOut()}>
              <ZoomOut size={15} />
            </button>
            <button title="Zoom in" onClick={() => viewer.current?.zoomIn()}>
              <ZoomIn size={15} />
            </button>
            <span className="pill-sep" />
            <button title="Show the code for the middle of this view" onClick={() => void goToCode()}>
              <ChevronLeft size={15} /> Code
            </button>
            <button title="Show the cursor position in the PDF" onClick={() => void goToPdf()}>
              Go to PDF <ChevronRight size={15} />
            </button>
          </div>
        )}
        {logsOpen && <LogsPanel />}
      </div>
    </section>
  );
}

function CompileButton() {
  const status = useStore((s) => s.compileStatus);
  const result = useStore((s) => s.compileResult);
  const settings = useStore((s) => s.settings);
  const system = useStore((s) => s.system);
  const config = useStore((s) => s.config);
  const autoCompile = useStore((s) => s.prefs.autoCompile);
  const st = useStore.getState;
  const errors = result?.issues.filter((i) => i.level === "error").length ?? 0;

  let icon = <Play size={14} />;
  let label = "Compile";
  let tone = "";
  if (status === "compiling") {
    icon = <Spinner size={14} />;
    label = "Compiling…";
  } else if (status === "success") {
    icon = <Check size={15} />;
    label = "Compiled";
  } else if (status === "error") {
    icon = <AlertTriangle size={14} />;
    label = `Compiled · ${errors} error${errors === 1 ? "" : "s"}`;
    tone = "warn";
  } else if (status === "failure" || status === "timeout") {
    icon = <CircleAlert size={14} />;
    label = status === "timeout" ? "Timed out" : "Failed";
    tone = "danger";
  } else if (status === "cancelled") {
    icon = <Square size={12} />;
    label = "Stopped";
  }

  const current: Engine = settings?.engine ?? config?.compiler.engine ?? "auto";
  return (
    <div className={`compile-group ${tone}`}>
      <button
        className="compile-main"
        onClick={() => (status === "compiling" ? void st().stopCompile() : void st().compile())}
        title={status === "compiling" ? "Stop" : `Recompile (${mod}↵)`}
      >
        {icon}
        <span>{label}</span>
      </button>
      <Menu
        trigger={({ toggle }) => (
          <button className="compile-more" onClick={toggle} title="Compiler options">
            <ChevronDown size={14} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>Compiler</MenuLabel>
            {(Object.keys(ENGINE_LABELS) as Engine[]).map((e) => {
              const t = system?.tools ?? {};
              const available =
                e === "auto" ? !!(t.latexmk || t.pdflatex || t.tectonic) : e === "latex" ? !!(t.latex && t.dvipdfmx) : !!t[ENGINE_TOOL[e]];
              return (
                <MenuItem
                  key={e}
                  checked={current === e}
                  disabled={!available}
                  label={ENGINE_LABELS[e]}
                  hint={!available ? "not installed" : e === "auto" && result && current === "auto" ? ENGINE_LABELS[result.engine] : undefined}
                  onClick={() => {
                    close();
                    void st().saveSettings({ engine: e }).then(() => st().compile());
                  }}
                />
              );
            })}
            <MenuSeparator />
            <MenuItem checked={autoCompile} label="Auto-compile on edit" onClick={() => st().setPrefs({ autoCompile: !autoCompile })} />
            <MenuItem icon={<ScrollText size={14} />} label="Logs & issues" onClick={() => (close(), useStore.setState({ logsOpen: true }))} />
            <MenuItem icon={<FileText size={14} />} label="Main document & settings…" onClick={() => (close(), st().setDialog({ kind: "projectSettings" }))} />
            <MenuItem
              icon={<Trash2 size={14} />}
              label="Clear cache & recompile"
              onClick={async () => {
                close();
                await api.clearCache(st().project!.id);
                await st().compile();
              }}
            />
            {status === "compiling" && <MenuItem icon={<Square size={14} />} label="Stop compiling" onClick={() => (close(), void st().stopCompile())} />}
          </>
        )}
      </Menu>
      {result && status !== "compiling" && (
        <span className="compile-meta" title={`Main: ${result.mainFile} · engine ${result.engineSource === "magic-comment" ? "from % !TEX program" : result.engineSource === "detected" ? "auto-detected" : "from settings"}`}>
          {ENGINE_LABELS[result.engine]} · {(result.durationMs / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

function PdfMoreMenu({ url }: { url: string | null }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  return (
    <Menu
      align="end"
      trigger={({ toggle }) => (
        <button className="icon-btn" onClick={toggle} title="More">
          <MoreHorizontal size={17} />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon={<Contrast size={14} />} checked={prefs.pdfDark} label="Dark PDF" onClick={() => setPrefs({ pdfDark: !prefs.pdfDark })} />
          <MenuItem icon={<ExternalLink size={14} />} label="Open PDF in new tab" disabled={!url} onClick={() => (close(), url && window.open(url, "_blank"))} />
          <MenuSeparator />
          <MenuLabel>Layout</MenuLabel>
          <MenuItem checked={prefs.layout === "split"} label="Editor & PDF" onClick={() => setPrefs({ layout: "split" })} />
          <MenuItem checked={prefs.layout === "editor"} label="Editor only" onClick={() => setPrefs({ layout: "editor" })} />
          <MenuItem checked={prefs.layout === "pdf"} label="PDF only" onClick={() => setPrefs({ layout: "pdf" })} />
          <MenuItem icon={<Columns2 size={14} />} label="Swap editor and PDF" onClick={() => setPrefs({ swapPanes: !prefs.swapPanes })} />
          <MenuItem
            icon={prefs.sidebarSide === "left" ? <PanelRight size={14} /> : <PanelLeft size={14} />}
            label={`Files panel on the ${prefs.sidebarSide === "left" ? "right" : "left"}`}
            onClick={() => setPrefs({ sidebarSide: prefs.sidebarSide === "left" ? "right" : "left", sidebarOpen: true })}
          />
        </>
      )}
    </Menu>
  );
}

function PdfPlaceholder({ status }: { status: string }) {
  const result = useStore((s) => s.compileResult);
  const firstError = result?.issues.find((i) => i.level === "error");
  return (
    <div className="pdf-placeholder">
      {status === "compiling" ? (
        <>
          <Spinner size={22} />
          <div>Compiling…</div>
        </>
      ) : status === "idle" ? (
        <>
          <div>Compile to see the PDF</div>
          <button className="btn primary" onClick={() => void useStore.getState().compile()}>
            <Play size={14} /> Compile
          </button>
        </>
      ) : (
        <>
          <CircleAlert size={26} className="danger-text" />
          <div className="ph-title">No PDF was produced</div>
          {firstError && <div className="ph-error">{firstError.message}</div>}
          <div className="row-gap">
            <button className="btn" onClick={() => useStore.setState({ logsOpen: true })}>
              <ScrollText size={14} /> View logs
            </button>
            <button className="btn primary" onClick={() => void useStore.getState().compile()}>
              <RefreshCw size={14} /> Recompile
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LogsPanel() {
  const result = useStore((s) => s.compileResult);
  const [filter, setFilter] = useState<"all" | LogIssue["level"]>("all");
  const [raw, setRaw] = useState(false);
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, typesetting: 0 };
    for (const i of result?.issues ?? []) c[i.level]++;
    return c;
  }, [result]);
  const issues = (result?.issues ?? []).filter((i) => filter === "all" || i.level === filter);

  return (
    <div className="logs-panel">
      <div className="logs-head">
        <div className="seg">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            All
          </button>
          <button className={filter === "error" ? "on" : ""} onClick={() => setFilter("error")}>
            Errors <span className="count danger">{counts.error}</span>
          </button>
          <button className={filter === "warning" ? "on" : ""} onClick={() => setFilter("warning")}>
            Warnings <span className="count warn">{counts.warning}</span>
          </button>
          <button className={filter === "typesetting" ? "on" : ""} onClick={() => setFilter("typesetting")}>
            Boxes <span className="count">{counts.typesetting}</span>
          </button>
        </div>
        <div className="grow" />
        <button className={`btn ghost sm${raw ? " on" : ""}`} onClick={() => setRaw(!raw)}>
          <ScrollText size={13} /> Raw log
        </button>
        <button className="icon-btn" onClick={() => useStore.setState({ logsOpen: false })} title="Close logs">
          <X size={16} />
        </button>
      </div>
      <div className="logs-scroll">
        {!result && <div className="empty-hint">Nothing compiled yet.</div>}
        {raw && result && <pre className="raw-log">{result.log || result.output || "(empty)"}</pre>}
        {!raw && result && issues.length === 0 && (
          <div className="logs-clean">
            <Check size={18} /> {filter === "all" ? "No problems found." : "Nothing in this category."}
          </div>
        )}
        {!raw && issues.map((issue, i) => <IssueCard key={i} issue={issue} />)}
      </div>
    </div>
  );
}

function IssueCard({ issue }: { issue: LogIssue }) {
  const tone = issue.level === "error" ? "danger" : issue.level === "warning" ? "warn" : "muted";
  const tree = useStore((s) => s.tree);
  const inProject = useMemo(() => {
    if (!issue.file) return false;
    const walk = (ns: typeof tree): boolean => ns.some((n) => n.path === issue.file || (n.children ? walk(n.children) : false));
    return walk(tree);
  }, [issue.file, tree]);
  return (
    <div className={`issue ${tone}`}>
      <div className="issue-top">
        {issue.level === "error" ? <CircleAlert size={14} /> : <AlertTriangle size={14} />}
        <span className="issue-msg">{issue.message}</span>
      </div>
      {(issue.file || issue.line) && (
        <button
          className="issue-loc"
          disabled={!inProject || !issue.line}
          onClick={() => issue.file && issue.line && useStore.getState().goTo(issue.file, issue.line)}
        >
          {issue.file ?? "?"}
          {issue.line ? `:${issue.line}` : ""}
        </button>
      )}
      {issue.content && <pre className="issue-content">{issue.content}</pre>}
      {issue.level === "error" && (
        <button
          className="btn ghost sm issue-ai"
          onClick={() => {
            const st = useStore.getState();
            let snippet = "";
            const d = issue.file ? st.docs[issue.file] : undefined;
            if (d && issue.line) {
              const lines = d.content.split("\n");
              snippet = lines.slice(Math.max(0, issue.line - 6), issue.line + 5).map((l, i) => `${Math.max(1, issue.line! - 5) + i}: ${l}`).join("\n");
            }
            st.askInChat(
              `My LaTeX compile fails with this error. Explain the cause and give the corrected LaTeX.\n\nError: ${issue.message}${issue.file ? `\nFile: ${issue.file}${issue.line ? `:${issue.line}` : ""}` : ""}${issue.content ? `\nLog context:\n${issue.content}` : ""}${snippet ? `\n\nSource around the error:\n\`\`\`latex\n${snippet}\n\`\`\`` : ""}`,
            );
          }}
        >
          <Sparkles size={13} /> Ask AI to fix
        </button>
      )}
    </div>
  );
}
