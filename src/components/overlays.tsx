import type { ReactNode } from "react";
import { create } from "zustand";
import { ConfirmDialog, Popover, PromptDialog } from "./ui";

type Overlay =
  | { kind: "prompt"; title: string; label?: string; initial?: string; confirm?: string; selectBase?: boolean; onSubmit: (v: string) => void | Promise<void> }
  | { kind: "confirm"; title: string; body: ReactNode; confirm?: string; danger?: boolean; onConfirm: () => void | Promise<void> }
  | { kind: "context"; x: number; y: number; render: (close: () => void) => ReactNode };

interface OverlayState {
  overlay: Overlay | null;
  open: (o: Overlay) => void;
  close: () => void;
}

export const useOverlay = create<OverlayState>((set) => ({
  overlay: null,
  open: (overlay) => set({ overlay }),
  close: () => set({ overlay: null }),
}));

export const prompt = (o: Omit<Extract<Overlay, { kind: "prompt" }>, "kind">) => useOverlay.getState().open({ kind: "prompt", ...o });
export const confirmAction = (o: Omit<Extract<Overlay, { kind: "confirm" }>, "kind">) => useOverlay.getState().open({ kind: "confirm", ...o });
export const contextMenu = (e: React.MouseEvent, render: (close: () => void) => ReactNode) => {
  e.preventDefault();
  e.stopPropagation();
  useOverlay.getState().open({ kind: "context", x: e.clientX, y: e.clientY, render });
};

export function OverlayHost() {
  const { overlay, close } = useOverlay();
  if (!overlay) return null;
  if (overlay.kind === "prompt") return <PromptDialog {...overlay} onClose={close} />;
  if (overlay.kind === "confirm") return <ConfirmDialog {...overlay} onClose={close} />;
  return (
    <Popover x={overlay.x} y={overlay.y} onClose={close} className="menu">
      {overlay.render(close)}
    </Popover>
  );
}
