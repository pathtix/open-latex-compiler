import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { DialogHost } from "./components/Dialogs";
import { Home } from "./components/Home";
import { Logo } from "./components/Logo";
import { OverlayHost } from "./components/overlays";
import { Workspace } from "./components/Workspace";
import { desktop } from "./lib/desktop";
import { useStore } from "./lib/store";

export function App() {
  const ready = useStore((s) => s.ready);
  const project = useStore((s) => s.project);
  const theme = useStore((s) => s.prefs.theme);
  const [error, setError] = useState("");

  useEffect(() => {
    useStore.getState().init().catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    desktop?.setTheme(theme);
  }, [theme]);

  if (error) {
    return (
      <div className="boot">
        <Logo size={34} />
        <div className="boot-error">Could not reach the Open LaTeX Compiler server: {error}</div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="boot">
        <Logo size={34} />
      </div>
    );
  }
  return (
    <>
      {project ? <Workspace /> : <Home />}
      <DialogHost />
      <OverlayHost />
      <Toasts />
    </>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "error" ? <CircleAlert size={15} /> : t.kind === "success" ? <CheckCircle2 size={15} /> : <Info size={15} />}
          <span>{t.text}</span>
          <button className="icon-btn tiny" onClick={() => useStore.getState().dismissToast(t.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
