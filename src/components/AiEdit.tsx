import { ArrowUp, Check, ChevronDown, ChevronRight, Copy, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { editorBridge } from "../editor/bridge";
import { getAiRange, setAiRange } from "../editor/setup";
import { buildEditMessages, fitWhitespace } from "../lib/ai";
import { wordDiff } from "../lib/diff";
import { streamChat, stripFences } from "../lib/llm";
import { useStore } from "../lib/store";
import { ModelPicker } from "./ModelPicker";
import { Kbd, mod } from "./ui";

const EDIT_ACTIONS = [
  { label: "Improve writing", prompt: "Improve the clarity, flow and academic tone of this text without changing its meaning." },
  { label: "Fix grammar", prompt: "Fix grammar, spelling and punctuation. Change nothing else." },
  { label: "Shorten", prompt: "Make this more concise while keeping all key information." },
  { label: "Expand", prompt: "Expand this with more detail and explanation, in the same style." },
  { label: "More formal", prompt: "Rewrite in a more formal academic register." },
  { label: "Simplify", prompt: "Rewrite this in simpler, plainer language." },
  { label: "To English", prompt: "Translate this into English, keeping all LaTeX markup intact." },
  { label: "Fix LaTeX", prompt: "Fix any LaTeX syntax errors or bad practices in this fragment while keeping the content." },
];

const GENERATE_ACTIONS = [
  { label: "Table", prompt: "Insert a booktabs table with a caption and label. Ask nothing; use sensible placeholder data: " },
  { label: "Figure", prompt: "Insert a figure environment with \\includegraphics, caption and label for: " },
  { label: "Equation", prompt: "Write a numbered equation (with label) for: " },
  { label: "Paragraph", prompt: "Write a paragraph about: " },
  { label: "Itemize", prompt: "Write an itemized list of: " },
];

type Phase = "prompt" | "streaming" | "done" | "error";

export interface AiEditTarget {
  path: string;
  from: number;
  to: number;
  original: string;
}

export function AiEdit({ target, paneRef, onClose }: { target: AiEditTarget; paneRef: React.RefObject<HTMLDivElement | null>; onClose: () => void }) {
  const generate = target.from === target.to;
  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<Phase>("prompt");
  const [result, setResult] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [showReasoning, setShowReasoning] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"diff" | "result">("diff");
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const lastInstruction = useRef("");

  // Highlight the target range in the editor while the card is open.
  useEffect(() => {
    const v = editorBridge.view;
    v?.dispatch({ effects: setAiRange.of({ from: target.from, to: target.to }) });
    input.current?.focus();
    return () => {
      controller.current?.abort();
      editorBridge.view?.dispatch({ effects: setAiRange.of(null) });
    };
  }, [target.from, target.to]);

  const place = () => {
    const v = editorBridge.view;
    const pane = paneRef.current;
    if (!v || !pane) return;
    const range = getAiRange(v.state) ?? { from: target.from, to: target.to };
    const paneRect = pane.getBoundingClientRect();
    const end = v.coordsAtPos(range.to) ?? v.coordsAtPos(range.from);
    const start = v.coordsAtPos(range.from);
    const width = Math.min(680, paneRect.width - 48);
    const left = Math.max(24, Math.min((start?.left ?? paneRect.left) - paneRect.left - 12, paneRect.width - width - 24));
    const cardH = card.current?.offsetHeight ?? 160;
    let top = (end?.bottom ?? paneRect.top + 80) - paneRect.top + 8;
    if (top + cardH > paneRect.height - 12) {
      const above = (start?.top ?? 0) - paneRect.top - cardH - 8;
      top = above > 8 ? above : Math.max(8, paneRect.height - cardH - 12);
    }
    setPos({ top, left, width });
  };
  useLayoutEffect(place, [phase, result.length > 0, reasoning.length > 0, showReasoning]);
  useEffect(() => {
    const v = editorBridge.view;
    if (!v) return;
    const onScroll = () => requestAnimationFrame(place);
    v.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      v.scrollDOM.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  });

  const run = async (text: string) => {
    const instr = text.trim();
    if (!instr) return;
    lastInstruction.current = instr;
    const v = editorBridge.view;
    if (!v) return;
    const range = getAiRange(v.state) ?? { from: target.from, to: target.to };
    const messages = buildEditMessages({ doc: v.state.doc.toString(), from: range.from, to: range.to, instruction: instr, path: target.path });
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setPhase("streaming");
    setResult("");
    setReasoning("");
    setError("");
    try {
      const out = await streamChat(messages, {
        signal: ctrl.signal,
        onUpdate: (s) => {
          setResult(stripFences(s.content));
          setReasoning(s.reasoning);
        },
      });
      setResult(stripFences(out.content));
      setPhase(out.content.trim() ? "done" : "error");
      if (!out.content.trim()) setError("The model returned an empty response.");
    } catch (e) {
      if (ctrl.signal.aborted) {
        setPhase((p) => (p === "streaming" ? "done" : p));
        return;
      }
      setError((e as Error).message);
      setPhase("error");
    }
  };

  const accept = () => {
    const v = editorBridge.view;
    if (!v || !result.trim()) return;
    const range = getAiRange(v.state) ?? { from: target.from, to: target.to };
    const original = v.state.sliceDoc(range.from, range.to);
    const text = generate ? result.replace(/\s+$/, "") : fitWhitespace(original, result);
    v.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from, head: range.from + text.length },
      effects: setAiRange.of(null),
      userEvent: "input.ai",
      scrollIntoView: true,
    });
    v.focus();
    onClose();
  };

  const reject = () => {
    controller.current?.abort();
    editorBridge.view?.focus();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        reject();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && phase === "done") {
        e.preventDefault();
        accept();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // Grow the prompt box when a quick action fills it programmatically.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [instruction]);

  const diff = useMemo(() => (phase !== "prompt" && !generate && view === "diff" ? wordDiff(target.original, fitWhitespace(target.original, result)) : null), [result, phase, generate, view, target.original]);
  const actions = generate ? GENERATE_ACTIONS : EDIT_ACTIONS;
  const thinking = phase === "streaming" && !result && !!reasoning;

  return (
    <div className="ai-card" ref={card} style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: "hidden" }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="ai-input-row">
        <Sparkles size={15} className="ai-spark" />
        <textarea
          ref={input}
          rows={1}
          value={instruction}
          placeholder={generate ? "Describe what to write here…" : "How should this be changed?"}
          onChange={(e) => {
            setInstruction(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              void run(instruction);
            }
          }}
        />
        <ModelPicker />
        {phase === "streaming" ? (
          <button className="send-btn" onClick={() => controller.current?.abort()} title="Stop">
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button className="send-btn" disabled={!instruction.trim()} onClick={() => void run(instruction)} title="Run">
            <ArrowUp size={15} />
          </button>
        )}
        <button className="icon-btn" onClick={reject} title="Close (Esc)">
          <X size={15} />
        </button>
      </div>

      {phase === "prompt" && (
        <div className="ai-chips">
          {actions.map((a) => (
            <button
              key={a.label}
              className="chip"
              onClick={() => {
                if (a.prompt.endsWith(": ")) {
                  setInstruction(a.prompt);
                  input.current?.focus();
                } else {
                  setInstruction(a.prompt);
                  void run(a.prompt);
                }
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {phase !== "prompt" && (
        <div className="ai-result">
          {(reasoning || thinking) && (
            <button className="ai-thinking" onClick={() => setShowReasoning(!showReasoning)}>
              {showReasoning ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {thinking ? <span className="shimmer">Thinking…</span> : "Reasoning"}
            </button>
          )}
          {showReasoning && reasoning && <pre className="ai-reasoning">{reasoning}</pre>}
          {phase === "streaming" && !result && !reasoning && <div className="ai-waiting shimmer">Waiting for the model…</div>}
          {result && (
            <pre className="ai-output">
              {diff
                ? diff.map((p, i) => (
                    <span key={i} className={`d-${p.type}`}>
                      {p.text}
                    </span>
                  ))
                : result}
              {phase === "streaming" && <span className="caret-blink" />}
            </pre>
          )}
          {phase === "error" && <div className="ai-error">{error}</div>}
          <div className="ai-actions">
            {!generate && result && (
              <div className="seg">
                <button className={view === "diff" ? "on" : ""} onClick={() => setView("diff")}>
                  Changes
                </button>
                <button className={view === "result" ? "on" : ""} onClick={() => setView("result")}>
                  Result
                </button>
              </div>
            )}
            <div className="grow" />
            {result && (
              <button className="btn ghost sm" onClick={() => void navigator.clipboard.writeText(result)} title="Copy">
                <Copy size={13} />
              </button>
            )}
            <button className="btn ghost sm" onClick={() => void run(lastInstruction.current)} disabled={phase === "streaming"}>
              <RotateCcw size={13} /> Retry
            </button>
            <button className="btn ghost sm" onClick={reject}>
              Discard <Kbd>Esc</Kbd>
            </button>
            <button className="btn primary sm" onClick={accept} disabled={phase === "streaming" || !result.trim()}>
              <Check size={13} /> {generate ? "Insert" : "Accept"} <Kbd>{mod}↵</Kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
