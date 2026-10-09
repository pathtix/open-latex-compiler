import { openSearchPanel } from "@codemirror/search";
import {
  AlertTriangle,
  CircleAlert,
  Download,
  FileQuestion,
  Hash,
  MessageCircle,
  Minus,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  Search,
  Sparkles,
  Type,
  WrapText,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { editorBridge } from "../editor/bridge";
import { CodeEditor, type SelectionInfo } from "../editor/CodeEditor";
import { useChatRuntime } from "../lib/ai";
import { api } from "../lib/api";
import { wordCount } from "../lib/latex";
import { useStore } from "../lib/store";
import { PdfViewerView } from "../pdf/PdfViewer";
import { AiEdit, type AiEditTarget } from "./AiEdit";
import { ChatInput, ChatPanel } from "./Chat";
import { fileIcon } from "./FileTree";
import { Kbd, Menu, MenuItem, MenuLabel, MenuSeparator, mod } from "./ui";

export const AI_EDIT_EVENT = "latexcompile:ai-edit";

export function EditorPane() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const doc = useStore((s) => (s.active ? s.docs[s.active] : undefined));
  const project = useStore((s) => s.project)!;
  const prefs = useStore((s) => s.prefs);
  const body = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<SelectionInfo | null>(null);
  const [aiTarget, setAiTarget] = useState<AiEditTarget | null>(null);

  const openAi = useCallback(() => {
    const v = editorBridge.view;
    const path = editorBridge.path;
    if (!v || !path) return;
    const { from, to } = v.state.selection.main;
    setAiTarget({ path, from, to, original: v.state.sliceDoc(from, to) });
  }, []);

  // Close the AI card when switching files.
  useEffect(() => setAiTarget(null), [active]);

  useEffect(() => {
    const onReq = () => openAi();
    window.addEventListener(AI_EDIT_EVENT, onReq);
    return () => window.removeEventListener(AI_EDIT_EVENT, onReq);
  }, [openAi]);

  const hasText = doc?.kind === "text";
  const paneRect = body.current?.getBoundingClientRect();
  const showSelBar = !!(hasText && sel?.focused && sel.byUser && !sel.empty && sel.rect && !aiTarget && paneRect);
  let selBarStyle: React.CSSProperties | undefined;
  if (showSelBar && sel?.rect && paneRect) {
    const top = sel.rect.top - paneRect.top - 42;
    selBarStyle = {
      top: top < 4 ? sel.rect.bottom - paneRect.top + 8 : top,
      left: Math.min(Math.max(12, sel.rect.left - paneRect.left - 20), paneRect.width - 230),
    };
  }

  return (
    <section className="editor-pane">
      <div className="pane-header editor-header">
        {!prefs.sidebarOpen && (
          <button className="icon-btn" title="Show files" onClick={() => useStore.getState().setPrefs({ sidebarOpen: true })}>
            {prefs.sidebarSide === "left" ? <PanelLeftOpen size={17} /> : <PanelRightOpen size={17} />}
          </button>
        )}
        <div className="tabs" onWheel={(e) => (e.currentTarget.scrollLeft += e.deltaY)}>
          {tabs.map((t) => (
            <Tab key={t} path={t} active={t === active} />
          ))}
        </div>
        <ToolsMenu />
      </div>

      <div className="editor-body" ref={body}>
        {tabs.length === 0 && <EmptyEditor />}
        <div className="editor-host" style={{ display: hasText ? undefined : "none", ["--editor-font-size" as string]: `${prefs.fontSize}px` }}>
          {active && hasText && !doc?.loading && (
            <CodeEditor path={active} onSelection={setSel} onAiEdit={openAi} />
          )}
          {active && hasText && doc?.loading && <div className="editor-loading" />}
        </div>
        {doc?.kind === "image" && (
          <div className="preview image-preview">
            <img src={api.fileUrl(project.id, doc.path) + `&v=${doc.extVersion}`} alt={doc.path} />
            <div className="preview-caption">{doc.path}</div>
          </div>
        )}
        {doc?.kind === "pdf" && (
          <div className="preview pdf-file-preview">
            <PdfViewerView url={api.fileUrl(project.id, doc.path)} />
          </div>
        )}
        {doc?.kind === "binary" && (
          <div className="preview binary-preview">
            <FileQuestion size={36} />
            <div>{doc.path} can't be edited here.</div>
            <a className="btn" href={api.fileUrl(project.id, doc.path, true)}>
              <Download size={14} /> Download
            </a>
          </div>
        )}
        {doc?.error && <div className="preview binary-preview">{doc.error}</div>}

        {showSelBar && (
          <div className="sel-bar" style={selBarStyle} onMouseDown={(e) => e.preventDefault()}>
            <button onClick={openAi}>
              <Sparkles size={13} /> Edit <Kbd>{mod}K</Kbd>
            </button>
            <span className="sel-bar-sep" />
            <button
              onClick={() => {
                const s = editorBridge.selection();
                if (!s) return;
                useChatRuntime.getState().addAttachment({ kind: "selection", label: `Selection from ${editorBridge.path}`, content: s.text });
                useStore.setState({ chatOpen: true });
                (document.querySelector(".chat-input textarea") as HTMLTextAreaElement | null)?.focus();
              }}
            >
              <MessageCircle size={13} /> Ask <Kbd>{mod}L</Kbd>
            </button>
          </div>
        )}

        {aiTarget && <AiEdit target={aiTarget} paneRef={body} onClose={() => setAiTarget(null)} />}
      </div>

      <div className="editor-bottom">
        <ChatPanel />
        <ChatInput />
      </div>
    </section>
  );
}

function Tab({ path, active }: { path: string; active: boolean }) {
  const dirty = useStore((s) => {
    const d = s.docs[path];
    return !!d && d.content !== d.saved;
  });
  const name = path.split("/").pop()!;
  return (
    <div
      className={`tab${active ? " active" : ""}`}
      onClick={() => useStore.getState().setActive(path)}
      onAuxClick={(e) => e.button === 1 && useStore.getState().closeTab(path)}
      title={path}
    >
      <span className="tab-icon">{fileIcon(name, 13)}</span>
      <span className="tab-name">{name}</span>
      <button
        className={`tab-close${dirty ? " dirty" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          useStore.getState().closeTab(path);
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function ToolsMenu() {
  const result = useStore((s) => s.compileResult);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const errors = result?.issues.filter((i) => i.level === "error").length ?? 0;
  const warnings = result?.issues.filter((i) => i.level !== "error").length ?? 0;
  const tone = errors ? "danger" : warnings ? "warn" : "";
  const content = useStore((s) => (s.active ? s.docs[s.active]?.content : undefined));
  return (
    <Menu
      align="end"
      trigger={({ toggle, open }) => (
        <button className={`tools-btn ${tone}${open ? " open" : ""}`} onClick={toggle}>
          Tools
          {errors > 0 ? <CircleAlert size={14} /> : warnings > 0 ? <AlertTriangle size={14} /> : null}
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem
            icon={errors ? <CircleAlert size={14} /> : <AlertTriangle size={14} />}
            label="Logs & issues"
            hint={result ? `${errors} errors · ${warnings} warnings` : undefined}
            onClick={() => (close(), useStore.setState({ logsOpen: true }))}
          />
          <MenuItem
            icon={<Search size={14} />}
            label="Find & replace"
            hint={`${mod}F`}
            onClick={() => {
              close();
              if (editorBridge.view) openSearchPanel(editorBridge.view);
            }}
          />
          <MenuItem icon={<Search size={14} />} label="Search project" onClick={() => (close(), useStore.setState({ sidebarTab: "search", prefs: { ...prefs, sidebarOpen: true } }))} />
          <MenuItem icon={<Sparkles size={14} />} label="AI edit / generate" hint={`${mod}K`} onClick={() => (close(), window.dispatchEvent(new Event(AI_EDIT_EVENT)))} />
          <MenuSeparator />
          <MenuLabel>Editor</MenuLabel>
          <MenuItem icon={<WrapText size={14} />} checked={prefs.wordWrap} label="Word wrap" onClick={() => setPrefs({ wordWrap: !prefs.wordWrap })} />
          <div className="menu-inline">
            <Type size={14} />
            <span>Font size</span>
            <div className="grow" />
            <button className="icon-btn tiny" onClick={() => setPrefs({ fontSize: Math.max(10, prefs.fontSize - 1) })}>
              <Minus size={12} />
            </button>
            <span className="mono-small">{prefs.fontSize}</span>
            <button className="icon-btn tiny" onClick={() => setPrefs({ fontSize: Math.min(24, prefs.fontSize + 1) })}>
              <Plus size={12} />
            </button>
          </div>
          {content !== undefined && (
            <div className="menu-inline muted">
              <Hash size={14} />
              <span>Words in this file</span>
              <div className="grow" />
              <WordCount text={content} />
            </div>
          )}
        </>
      )}
    </Menu>
  );
}

function WordCount({ text }: { text: string }) {
  const n = useMemo(() => wordCount(text), [text]);
  return <span className="mono-small">{n.toLocaleString()}</span>;
}

function EmptyEditor() {
  return (
    <div className="empty-editor">
      <div className="empty-title">No file open</div>
      <div className="shortcut-list">
        <span>Compile</span>
        <Kbd>{mod}↵</Kbd>
        <span>Save & compile</span>
        <Kbd>{mod}S</Kbd>
        <span>AI edit / generate</span>
        <Kbd>{mod}K</Kbd>
        <span>Ask in chat</span>
        <Kbd>{mod}L</Kbd>
        <span>Jump to source</span>
        <span className="muted">double-click PDF</span>
      </div>
    </div>
  );
}
