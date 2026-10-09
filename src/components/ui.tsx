import { Check, Loader2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Floating panel anchored to a point; closes on outside click or Escape. */
export function Popover({
  x,
  y,
  onClose,
  children,
  align = "start",
  className = "",
  anchorBottom,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
  /** If the popover does not fit below, flip it above this y. */
  anchorBottom?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });

  // Re-placed whenever the content resizes (e.g. a list that loads after opening),
  // so a popover flipped above its anchor grows upwards instead of off-screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      let left = align === "end" ? x - width : x;
      let top = y;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      if (left < 8) left = 8;
      if (top + height > window.innerHeight - 8) top = Math.max(8, (anchorBottom !== undefined ? anchorBottom - 4 : y) - height);
      setPos((p) => (p.ready && p.left === left && p.top === top ? p : { left, top, ready: true }));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [x, y, align, anchorBottom]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className={`popover ${className}`} style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}

export function Menu({
  trigger,
  children,
  align = "start",
  className,
}: {
  trigger: (props: { open: boolean; toggle: (e: React.MouseEvent) => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = () => setAnchor(null);
  return (
    <>
      {trigger({
        open: !!anchor,
        toggle: (e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setAnchor((a) => (a ? null : r));
        },
      })}
      {anchor && (
        <Popover x={align === "end" ? anchor.right : anchor.left} y={anchor.bottom + 6} align={align} onClose={close} className={`menu ${className ?? ""}`} anchorBottom={anchor.top}>
          {children(close)}
        </Popover>
      )}
    </>
  );
}

export function MenuItem({
  icon,
  label,
  hint,
  onClick,
  danger,
  checked,
  disabled,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
}) {
  return (
    <button className={`menu-item${danger ? " danger" : ""}`} onClick={onClick} disabled={disabled} type="button">
      <span className="menu-icon">{checked !== undefined ? checked ? <Check size={14} /> : null : icon}</span>
      <span className="menu-label">{label}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );
}

export const MenuSeparator = () => <div className="menu-sep" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <div className="menu-section">{children}</div>;

export function Modal({ title, onClose, children, width = 520, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export const Spinner = ({ size = 14 }: { size?: number }) => <Loader2 size={size} className="spin" />;

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const mod = isMac ? "⌘" : "Ctrl+";

/** Simple text prompt rendered as a modal; resolves with the value or null. */
export function PromptDialog({
  title,
  label,
  initial = "",
  confirm = "OK",
  onSubmit,
  onClose,
  selectBase,
}: {
  title: string;
  label?: string;
  initial?: string;
  confirm?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
  selectBase?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current!;
    el.focus();
    if (selectBase) {
      const dot = initial.lastIndexOf(".");
      const slash = initial.lastIndexOf("/");
      el.setSelectionRange(slash + 1, dot > slash ? dot : initial.length);
    } else el.select();
  }, [initial, selectBase]);
  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={busy || !value.trim()}>
            {busy ? <Spinner /> : confirm}
          </button>
        </>
      }
    >
      {label && <label className="field-label">{label}</label>}
      <input ref={input} className="input" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      {error && <div className="field-error">{error}</div>}
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirm = "Delete",
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirm?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? "danger" : "primary"}`}
            disabled={busy}
            autoFocus
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
                onClose();
              }
            }}
          >
            {busy ? <Spinner /> : confirm}
          </button>
        </>
      }
    >
      <div className="confirm-body">{body}</div>
    </Modal>
  );
}
