import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { useStore } from "../lib/store";
import { editorBridge } from "./bridge";
import { createExtensions, setFlashLine, wrapCompartment, type EditorHooks } from "./setup";

export interface SelectionInfo {
  empty: boolean;
  focused: boolean;
  /** True when the selection was made by the user (mouse/keyboard), not by a snippet or command. */
  byUser: boolean;
  from: number;
  to: number;
  /** Viewport coordinates of the selection head, for floating UI. */
  rect: { top: number; bottom: number; left: number } | null;
}

interface Props {
  path: string;
  onSelection?: (info: SelectionInfo) => void;
  onAiEdit?: () => void;
  onScroll?: () => void;
}

export function CodeEditor({ path, onSelection, onAiEdit, onScroll }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const versions = useRef(new Map<string, number>());
  const pathRef = useRef(path);
  /** Which document the view's current state belongs to (null for a fresh view). */
  const viewPath = useRef<string | null>(null);
  const cbs = useRef({ onSelection, onAiEdit, onScroll });
  cbs.current = { onSelection, onAiEdit, onScroll };

  const doc = useStore((s) => s.docs[path]);
  const wrap = useStore((s) => s.prefs.wordWrap);
  const nav = useStore((s) => s.nav);
  const result = useStore((s) => s.compileResult);

  const hooks = useRef<EditorHooks>({
    compile: () => void useStore.getState().compile(),
    save: () => {
      const st = useStore.getState();
      void st.saveDoc(pathRef.current).then(() => st.compile());
    },
    aiEdit: () => cbs.current.onAiEdit?.(),
  });

  const makeState = (p: string, content: string) =>
    EditorState.create({
      doc: content,
      extensions: createExtensions(p, useStore.getState().prefs.wordWrap, hooks.current, listener),
    });

  const byUser = useRef(false);
  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged) useStore.getState().setContent(pathRef.current, u.state.doc.toString());
    if (u.selectionSet) byUser.current = u.transactions.some((tr) => tr.isUserEvent("select"));
    if (u.docChanged || u.selectionSet || u.focusChanged || u.geometryChanged) reportSelection(u.view);
  });

  const reportSelection = (view: EditorView) => {
    const cb = cbs.current.onSelection;
    if (!cb) return;
    const sel = view.state.selection.main;
    requestAnimationFrame(() => {
      const head = view.coordsAtPos(sel.head);
      const start = view.coordsAtPos(Math.min(sel.from, sel.to));
      cb({
        empty: sel.empty,
        focused: view.hasFocus,
        byUser: byUser.current,
        from: sel.from,
        to: sel.to,
        rect: head && start ? { top: Math.min(start.top, head.top), bottom: Math.max(head.bottom, start.bottom), left: head.left } : null,
      });
    });
  };

  // Create the view once.
  useEffect(() => {
    const view = new EditorView({ parent: host.current! });
    viewRef.current = view;
    viewPath.current = null;
    const onScrollEvt = () => {
      reportSelection(view);
      cbs.current.onScroll?.();
    };
    view.scrollDOM.addEventListener("scroll", onScrollEvt, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener("scroll", onScrollEvt);
      editorBridge.detach(view);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap documents when the active path changes or its content first arrives.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !doc || doc.loading || doc.kind !== "text") return;
    if (viewPath.current && states.current.has(viewPath.current)) states.current.set(viewPath.current, view.state);
    pathRef.current = path;

    let state = states.current.get(path);
    const known = versions.current.get(path);
    if (!state) {
      state = makeState(path, doc.content);
      versions.current.set(path, doc.extVersion);
    } else if (known !== doc.extVersion) {
      // Content replaced from outside (disk change); keep history but swap text.
      const tr = state.update({ changes: { from: 0, to: state.doc.length, insert: doc.content }, selection: EditorSelection.cursor(Math.min(state.selection.main.head, doc.content.length)) });
      state = tr.state;
      versions.current.set(path, doc.extVersion);
    }
    states.current.set(path, state);
    const switched = viewPath.current !== null && viewPath.current !== path;
    if (view.state !== state) {
      view.setState(state);
      view.dispatch({ effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) });
      states.current.set(path, view.state);
    }
    viewPath.current = path;
    // Opening another file moves the keyboard focus into it.
    if (switched) view.focus();
    editorBridge.attach(view, path);
    applyDiagnostics(view, path, useStore.getState().compileResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, doc?.loading, doc?.extVersion]);

  // Forget cached states for documents that were closed.
  const tabs = useStore((s) => s.tabs);
  useEffect(() => {
    for (const k of [...states.current.keys()]) {
      if (!tabs.includes(k)) {
        states.current.delete(k);
        versions.current.delete(k);
      }
    }
  }, [tabs]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && pathRef.current === path) applyDiagnostics(view, path, result);
  }, [result, path]);

  // Jump to a line (outline, search results, logs, PDF double-click).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !nav || nav.path !== path || !doc || doc.loading || pathRef.current !== path) return;
    const lineNo = Math.min(Math.max(1, nav.line), view.state.doc.lines);
    const line = view.state.doc.line(lineNo);
    const pos = Math.min(line.from + (nav.column ?? 0), line.to);
    view.dispatch({ selection: { anchor: pos }, effects: [EditorView.scrollIntoView(pos, { y: "center" }), setFlashLine.of(line.from)] });
    view.focus();
    const t = setTimeout(() => viewRef.current?.dispatch({ effects: setFlashLine.of(null) }), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav?.nonce, doc?.loading, path]);

  return <div className="code-editor" ref={host} />;
}

function applyDiagnostics(view: EditorView, path: string, result: ReturnType<typeof useStore.getState>["compileResult"]) {
  const diags: Diagnostic[] = [];
  for (const issue of result?.issues ?? []) {
    if (issue.file !== path || !issue.line) continue;
    if (issue.line > view.state.doc.lines) continue;
    const line = view.state.doc.line(issue.line);
    diags.push({
      from: line.from,
      to: Math.max(line.from, line.to),
      severity: issue.level === "error" ? "error" : issue.level === "warning" ? "warning" : "info",
      message: issue.message,
      source: result?.engine,
    });
  }
  view.dispatch(setDiagnostics(view.state, diags));
}
