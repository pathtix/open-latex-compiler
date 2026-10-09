import { FolderInput, FolderOpen, Link2, Moon, Plus, Search, Settings, Sun } from "lucide-react";
import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { Logo } from "./Logo";
import { importZip, relativeTime } from "./Sidebar";

export function Home() {
  const projects = useStore((s) => s.projects);
  const system = useStore((s) => s.system);
  const config = useStore((s) => s.config);
  const prefs = useStore((s) => s.prefs);
  const [q, setQ] = useState("");
  const st = useStore.getState;
  const filtered = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())), [projects, q]);
  const missingTex = system && !system.tools.latexmk && !system.tools.pdflatex && !system.tools.tectonic;

  return (
    <div className="home">
      <header className="home-top">
        <div className="home-brand">
          <Logo size={26} />
          <span>Open LaTeX Compiler</span>
        </div>
        <div className="grow" />
        <button className="icon-btn" title="Toggle theme" onClick={() => st().setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" })}>
          {prefs.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="icon-btn" title="Settings" onClick={() => st().setDialog({ kind: "settings" })}>
          <Settings size={16} />
        </button>
      </header>
      <main className="home-main">
        <h1>Projects</h1>
        <p className="home-sub">
          Local LaTeX projects in <code>{config?.workspace}</code>
        </p>
        {missingTex && (
          <div className="home-warning">
            No TeX distribution was found. Install MacTeX / TeX Live (or Tectonic) and restart Open LaTeX Compiler to compile documents.
          </div>
        )}
        <div className="home-actions">
          <button className="btn primary" onClick={() => st().setDialog({ kind: "newProject" })}>
            <Plus size={15} /> New project
          </button>
          <button className="btn" onClick={() => void st().openFolder()}>
            <FolderOpen size={15} /> Open folder
          </button>
          <button className="btn" onClick={importZip}>
            <FolderInput size={15} /> Import .zip
          </button>
          <div className="grow" />
          <div className="search-box home-search">
            <Search size={14} />
            <input placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="project-list">
          {filtered.map((p) => (
            <button key={p.id} className="project-card" onClick={() => void st().openProject(p.id)}>
              <div className="project-card-name">
                {p.name}
                {p.linked && (
                  <span className="badge" title="Opened from a folder outside the workspace">
                    <Link2 size={11} /> linked
                  </span>
                )}
              </div>
              <div className="project-card-path">{p.path}</div>
              <div className="project-card-time">{relativeTime(p.modified)}</div>
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-hint">{projects.length ? "No matching projects." : "No projects yet — create one to get started."}</div>}
        </div>
      </main>
    </div>
  );
}
