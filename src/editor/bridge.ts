import type { EditorView } from "@codemirror/view";

/** Gives non-editor components (chat, AI tools, PDF sync) access to the live editor. */
let current: { view: EditorView; path: string } | null = null;

export const editorBridge = {
  attach(view: EditorView, path: string) {
    current = { view, path };
  },
  detach(view: EditorView) {
    if (current?.view === view) current = null;
  },
  setPath(path: string) {
    if (current) current.path = path;
  },
  get view() {
    return current?.view ?? null;
  },
  get path() {
    return current?.path;
  },
  selection(): { from: number; to: number; text: string } | null {
    const v = current?.view;
    if (!v) return null;
    const { from, to } = v.state.selection.main;
    if (from === to) return null;
    return { from, to, text: v.state.sliceDoc(from, to) };
  },
  cursor(): { line: number; column: number; pos: number } | null {
    const v = current?.view;
    if (!v) return null;
    const pos = v.state.selection.main.head;
    const line = v.state.doc.lineAt(pos);
    return { line: line.number, column: pos - line.from, pos };
  },
  /** Replaces the selection (or inserts at the cursor when nothing is selected). */
  insert(text: string) {
    const v = current?.view;
    if (!v) return false;
    const { from, to } = v.state.selection.main;
    v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true, userEvent: "input.paste" });
    v.focus();
    return true;
  },
  focus() {
    current?.view.focus();
  },
};
