import {
  ArrowLeftRight,
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  MessageSquarePlus,
  Moon,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  Plus,
  Regex,
  ScanSearch,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SearchHit } from "../lib/api";
import { parseOutline, type OutlineItem } from "../lib/latex";
import { useStore } from "../lib/store";
import { FileTree, fileIcon, newFile, newFolder, pickAndUpload } from "./FileTree";
import { Logo } from "./Logo";
import { confirmAction, prompt } from "./overlays";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "./ui";

export function Sidebar() {
  const tab = useStore((s) => s.sidebarTab);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const [dragging, setDragging] = useState(false);

  const startOutlineResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = prefs.outlineHeight;
    setDragging(true);
    const move = (ev: PointerEvent) => setPrefs({ outlineHeight: Math.min(Math.max(80, startH - (ev.clientY - startY)), window.innerHeight - 260) });
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside className={`app-sidebar${dragging ? " resizing" : ""}`}>
      <div className="sidebar-top">
        <button className="logo-btn" onClick={() => useStore.getState().closeProject()} title="All projects">
          <Logo size={22} />
        </button>
        <button className="icon-btn" title="Hide sidebar" onClick={() => setPrefs({ sidebarOpen: false })}>
          {prefs.sidebarSide === "left" ? <PanelLeftClose size={17} /> : <PanelRightClose size={17} />}
        </button>
      </div>
      <ProjectSwitcher />
      <div className="sidebar-tabs">
        <button className={tab === "files" ? "active" : ""} onClick={() => useStore.setState({ sidebarTab: "files" })}>
          Files
        </button>
        <button className={tab === "chats" ? "active" : ""} onClick={() => useStore.setState({ sidebarTab: "chats" })}>
          Chats
        </button>
        <div className="grow" />
        <button className={`icon-btn${tab === "search" ? " on" : ""}`} title="Search in project" onClick={() => useStore.setState({ sidebarTab: tab === "search" ? "files" : "search" })}>
          <Search size={15} />
        </button>
        {tab === "chats" ? (
          <button className="icon-btn" title="New chat" onClick={() => useStore.getState().newChat()}>
            <MessageSquarePlus size={15} />
          </button>
        ) : (
          <Menu
            align="end"
            trigger={({ toggle }) => (
              <button className="icon-btn" title="New…" onClick={toggle}>
                <Plus size={16} />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem icon={<FilePlus2 size={14} />} label="New file" onClick={() => (close(), newFile(""))} />
                <MenuItem icon={<FolderPlus size={14} />} label="New folder" onClick={() => (close(), newFolder(""))} />
                <MenuItem icon={<Upload size={14} />} label="Upload files" onClick={() => (close(), pickAndUpload(""))} />
              </>
            )}
          </Menu>
        )}
      </div>
      <div className="sidebar-body">
        {tab === "files" && <FileTree />}
        {tab === "chats" && <ChatsList />}
        {tab === "search" && <SearchPanel />}
      </div>
      {tab === "files" && (
        <div className="outline" style={{ height: prefs.outlineOpen ? prefs.outlineHeight : undefined }}>
          {prefs.outlineOpen && <div className="outline-resize" onPointerDown={startOutlineResize} />}
          <button className="outline-head" onClick={() => setPrefs({ outlineOpen: !prefs.outlineOpen })}>
            {prefs.outlineOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Outline
          </button>
          {prefs.outlineOpen && <Outline />}
        </div>
      )}
      <SidebarFooter />
    </aside>
  );
}

function ProjectSwitcher() {
  const project = useStore((s) => s.project)!;
  const projects = useStore((s) => s.projects);
  const st = useStore.getState;
  return (
    <div className="project-switcher">
      <Menu
        className="project-menu"
        trigger={({ toggle, open }) => (
          <button className={`project-btn${open ? " open" : ""}`} onClick={(e) => (void st().refreshProjects(), toggle(e))}>
            <span className="project-name">{project.name}</span>
            <ChevronDown size={15} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>Projects</MenuLabel>
            <div className="menu-scroll">
              {projects.map((p) => (
                <MenuItem key={p.id} checked={p.id === project.id} label={p.name} hint={p.linked ? "linked" : undefined} onClick={() => (close(), void st().openProject(p.id))} />
              ))}
            </div>
            <MenuSeparator />
            <MenuItem icon={<Plus size={14} />} label="New project…" onClick={() => (close(), st().setDialog({ kind: "newProject" }))} />
            <MenuItem icon={<FolderOpen size={14} />} label="Open folder…" onClick={() => (close(), st().setDialog({ kind: "openFolder" }))} />
            <MenuItem icon={<FolderInput size={14} />} label="Import .zip…" onClick={() => (close(), importZip())} />
            <MenuItem icon={<LayoutGrid size={14} />} label="All projects" onClick={() => (close(), st().closeProject())} />
            <MenuSeparator />
            <MenuItem icon={<SlidersHorizontal size={14} />} label="Project settings…" onClick={() => (close(), st().setDialog({ kind: "projectSettings" }))} />
            <MenuItem
              icon={<Pencil size={14} />}
              label="Rename project"
              onClick={() => {
                close();
                prompt({
                  title: "Rename project",
                  initial: project.name,
                  confirm: "Rename",
                  onSubmit: async (name) => {
                    const p = await api.renameProject(project.id, name);
                    await st().refreshProjects();
                    useStore.setState({ project: undefined });
                    await st().openProject(p.id);
                  },
                });
              }}
            />
            <MenuItem icon={<Download size={14} />} label="Download source (.zip)" onClick={() => (close(), window.open(api.exportUrl(project.id)))} />
            <MenuItem icon={<ScanSearch size={14} />} label="Reveal in file manager" onClick={() => (close(), void api.reveal(project.id))} />
            <MenuSeparator />
            <MenuItem
              icon={<Trash2 size={14} />}
              danger
              label={project.linked ? "Remove from list" : "Delete project"}
              onClick={() => {
                close();
                confirmAction({
                  title: project.linked ? `Remove ${project.name}?` : `Delete ${project.name}?`,
                  confirm: project.linked ? "Remove" : "Delete",
                  body: project.linked ? (
                    <>The folder stays on disk at <code>{project.path}</code>; it is only removed from Open LaTeX Compiler.</>
                  ) : (
                    <>The project folder will be moved to <code>~/.latexcompile/trash</code>.</>
                  ),
                  onConfirm: async () => {
                    await api.deleteProject(project.id);
                    st().closeProject();
                  },
                });
              }}
            />
          </>
        )}
      </Menu>
    </div>
  );
}

export function importZip() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,application/zip";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const st = useStore.getState();
    try {
      const p = await api.importProject(file);
      await st.refreshProjects();
      await st.openProject(p.id);
      st.toast(`Imported ${p.name}`, "success");
    } catch (e) {
      st.toast(`Import failed: ${(e as Error).message}`, "error");
    }
  };
  input.click();
}

function Outline() {
  const active = useStore((s) => s.active);
  const content = useStore((s) => (s.active ? s.docs[s.active]?.content : undefined));
  const [deferred, setDeferred] = useState(content ?? "");
  useEffect(() => {
    const t = setTimeout(() => setDeferred(content ?? ""), 250);
    return () => clearTimeout(t);
  }, [content]);
  const items = useMemo(() => (active?.endsWith(".tex") ? parseOutline(deferred) : []), [deferred, active]);
  if (!items.length) return <div className="outline-empty">{active?.endsWith(".tex") ? "No sections in this file" : "Open a .tex file"}</div>;
  return (
    <div className="outline-body">
      {items.map((it, i) => (
        <OutlineNode key={`${it.line}-${i}`} item={it} depth={0} path={active!} />
      ))}
    </div>
  );
}

function OutlineNode({ item, depth, path }: { item: OutlineItem; depth: number; path: string }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="outline-row" style={{ paddingLeft: 14 + depth * 14 }} onClick={() => useStore.getState().goTo(path, item.line)} title={`Line ${item.line}`}>
        <span className="outline-title">{item.title}</span>
        {item.children.length > 0 && (
          <button
            className="outline-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
      </div>
      {open && item.children.map((c, i) => <OutlineNode key={`${c.line}-${i}`} item={c} depth={depth + 1} path={path} />)}
    </>
  );
}

function ChatsList() {
  const chats = useStore((s) => s.chats);
  const activeId = useStore((s) => s.activeChatId);
  const chatOpen = useStore((s) => s.chatOpen);
  const sorted = [...chats].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  return (
    <div className="chats-list">
      <button className="new-chat-row" onClick={() => useStore.getState().newChat()}>
        <MessageSquarePlus size={14} /> New chat
      </button>
      {sorted.length === 0 && <div className="empty-hint">Conversations with your local model show up here.</div>}
      {sorted.map((c) => (
        <div key={c.id} className={`chat-row${c.id === activeId && chatOpen ? " active" : ""}`} onClick={() => useStore.getState().openChat(c.id)}>
          <div className="chat-row-title">{c.title || "Untitled chat"}</div>
          <div className="chat-row-meta">{relativeTime(c.updatedAt ?? c.createdAt)}</div>
          <button
            className="icon-btn row-action"
            title="Delete chat"
            onClick={(e) => {
              e.stopPropagation();
              void useStore.getState().deleteChat(c.id);
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SearchPanel() {
  const project = useStore((s) => s.project)!;
  const [q, setQ] = useState("");
  const [regex, setRegex] = useState(false);
  const [cs, setCs] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (!q) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .search(project.id, q, regex, cs)
        .then((h) => {
          setHits(h);
          setError("");
        })
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, regex, cs, project.id]);

  const grouped = useMemo(() => {
    const m = new Map<string, SearchHit[]>();
    for (const h of hits ?? []) m.set(h.path, [...(m.get(h.path) ?? []), h]);
    return [...m.entries()];
  }, [hits]);

  return (
    <div className="search-panel">
      <div className="search-box">
        <Search size={14} />
        <input ref={input} placeholder="Search project" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button className="icon-btn tiny" onClick={() => setQ("")}>
            <X size={12} />
          </button>
        )}
        <button className={`icon-btn tiny${cs ? " on" : ""}`} title="Match case" onClick={() => setCs(!cs)}>
          <CaseSensitive size={14} />
        </button>
        <button className={`icon-btn tiny${regex ? " on" : ""}`} title="Regular expression" onClick={() => setRegex(!regex)}>
          <Regex size={13} />
        </button>
      </div>
      {error && <div className="field-error">{error}</div>}
      {hits && <div className="search-count">{hits.length === 500 ? "500+ results" : `${hits.length} result${hits.length === 1 ? "" : "s"}`}</div>}
      <div className="search-results">
        {grouped.map(([path, hs]) => (
          <div key={path} className="search-file">
            <div className="search-file-name">
              {fileIcon(path, 13)} {path}
            </div>
            {hs.map((h) => (
              <div key={`${h.line}-${h.col}`} className="search-hit" onClick={() => useStore.getState().goTo(h.path, h.line, h.col)}>
                <span className="search-line">{h.line}</span>
                <span className="search-text">{highlight(h.text, h.col, q, regex, cs)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function highlight(text: string, col: number, q: string, regex: boolean, cs: boolean) {
  let len = q.length;
  if (regex) {
    try {
      const m = new RegExp(q, cs ? "" : "i").exec(text.slice(col));
      len = m?.[0].length ?? 0;
    } catch {}
  }
  const start = Math.max(0, col - 30);
  return (
    <>
      {start > 0 && "…"}
      {text.slice(start, col).trimStart()}
      <mark>{text.slice(col, col + len)}</mark>
      {text.slice(col + len, col + len + 80)}
    </>
  );
}

function SidebarFooter() {
  const system = useStore((s) => s.system);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const user = system?.user ?? "you";
  return (
    <div className="sidebar-footer">
      <div className="avatar">{user.slice(0, 1).toUpperCase()}</div>
      <div className="who">
        <div className="who-name">{user}</div>
        <div className="who-sub">Local workspace</div>
      </div>
      <button className="icon-btn" title={prefs.theme === "dark" ? "Light theme" : "Dark theme"} onClick={() => setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" })}>
        {prefs.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <button className="icon-btn" title="Move file panel to the other side" onClick={() => setPrefs({ sidebarSide: prefs.sidebarSide === "left" ? "right" : "left" })}>
        <ArrowLeftRight size={15} />
      </button>
      <button className="icon-btn" title="Settings" onClick={() => useStore.getState().setDialog({ kind: "settings" })}>
        <Settings size={15} />
      </button>
    </div>
  );
}

export function relativeTime(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}
