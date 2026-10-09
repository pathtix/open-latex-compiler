import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { EditorPane } from "./EditorPane";
import { PdfPane } from "./PdfPane";
import { Sidebar } from "./Sidebar";

/** Three-pane layout: files | editor | PDF, with the files panel on either side. */
export function Workspace() {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const mainRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = e.metaKey || e.ctrlKey;
      if (m && e.key === "Enter") {
        e.preventDefault();
        void useStore.getState().compile();
      } else if (m && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void useStore.getState().saveAll().then(() => useStore.getState().compile());
      } else if (m && e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setPrefs({ sidebarOpen: !useStore.getState().prefs.sidebarOpen });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPrefs]);

  const drag = (kind: "sidebar" | "split") => (e: React.PointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startW = prefs.sidebarWidth;
    const rect = mainRef.current!.getBoundingClientRect();
    const sidebarRight = prefs.sidebarSide === "right";
    const move = (ev: PointerEvent) => {
      if (kind === "sidebar") {
        const dx = ev.clientX - startX;
        setPrefs({ sidebarWidth: Math.min(520, Math.max(190, startW + (sidebarRight ? -dx : dx))) });
      } else {
        let ratio = (ev.clientX - rect.left) / rect.width;
        if (prefs.swapPanes) ratio = 1 - ratio;
        setPrefs({ editorRatio: Math.min(0.85, Math.max(0.15, ratio)) });
      }
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const showEditor = prefs.layout !== "pdf";
  const showPdf = prefs.layout !== "editor";
  const editor = (
    <div className="pane-slot" style={{ flex: showPdf ? `${prefs.editorRatio} 1 0` : "1 1 0", display: showEditor ? undefined : "none" }}>
      <EditorPane />
    </div>
  );
  const pdf = (
    <div className="pane-slot" style={{ flex: showEditor ? `${1 - prefs.editorRatio} 1 0` : "1 1 0", display: showPdf ? undefined : "none" }}>
      <PdfPane />
    </div>
  );
  const splitter = showEditor && showPdf ? <div className="splitter" onPointerDown={drag("split")} onDoubleClick={() => setPrefs({ editorRatio: 0.5 })} /> : null;

  const sidebar = prefs.sidebarOpen ? (
    <>
      {prefs.sidebarSide === "right" && <div className="splitter sidebar-splitter" onPointerDown={drag("sidebar")} />}
      <div className="sidebar-slot" style={{ width: prefs.sidebarWidth }}>
        <Sidebar />
      </div>
      {prefs.sidebarSide === "left" && <div className="splitter sidebar-splitter" onPointerDown={drag("sidebar")} />}
    </>
  ) : null;

  return (
    <div className={`workspace${resizing ? " resizing" : ""}`}>
      {prefs.sidebarSide === "left" && sidebar}
      <div className="main-panes" ref={mainRef}>
        {prefs.swapPanes ? pdf : editor}
        {splitter}
        {prefs.swapPanes ? editor : pdf}
      </div>
      {prefs.sidebarSide === "right" && sidebar}
    </div>
  );
}
