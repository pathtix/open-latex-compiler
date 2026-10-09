import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type DecorationSet,
  type KeyBinding,
} from "@codemirror/view";
import { latexCompletions } from "./completions";
import { bibtexLanguage, latexLanguage, prismHighlight } from "./languages";

export const wrapCompartment = new Compartment();

// ---------------------------------------------------------------------------
// Range highlighted while an AI edit is pending; mapped through edits.
// ---------------------------------------------------------------------------
export const setAiRange = StateEffect.define<{ from: number; to: number } | null>();
const aiMark = Decoration.mark({ class: "cm-ai-range" });

export const aiRangeField = StateField.define<{ range: { from: number; to: number } | null; deco: DecorationSet }>({
  create: () => ({ range: null, deco: Decoration.none }),
  update(value, tr) {
    let range = value.range;
    if (range && tr.docChanged) range = { from: tr.changes.mapPos(range.from, 1), to: tr.changes.mapPos(range.to, -1) };
    for (const e of tr.effects) if (e.is(setAiRange)) range = e.value;
    if (range === value.range && !tr.docChanged) return value;
    const deco = range && range.to > range.from ? Decoration.set([aiMark.range(range.from, range.to)]) : Decoration.none;
    return { range, deco };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

// ---------------------------------------------------------------------------
// Brief highlight of a line after a jump (outline, logs, PDF double-click).
// ---------------------------------------------------------------------------
export const setFlashLine = StateEffect.define<number | null>();
const flashDeco = Decoration.line({ class: "cm-flash" });

export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFlashLine)) deco = e.value === null ? Decoration.none : Decoration.set([flashDeco.range(e.value)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function getAiRange(state: EditorState) {
  return state.field(aiRangeField, false)?.range ?? null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function wrapWith(cmd: string) {
  return (view: EditorView) => {
    const tr = view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to);
      const open = `\\${cmd}{`;
      const insert = `${open}${text}}`;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: range.empty ? EditorSelection.cursor(range.from + open.length) : EditorSelection.range(range.from + open.length, range.from + open.length + text.length),
      };
    });
    view.dispatch(view.state.update(tr, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--editor-bg)", color: "var(--editor-fg)", fontSize: "var(--editor-font-size)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.62", overflow: "auto" },
  ".cm-content": { caretColor: "var(--editor-caret)", padding: "10px 0 40vh" },
  ".cm-line": { padding: "0 18px 0 10px" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--editor-caret)", borderLeftWidth: "2px" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { backgroundColor: "var(--editor-bg)", color: "var(--editor-gutter)", border: "none", paddingLeft: "6px" },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "34px", padding: "0 10px 0 4px" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--editor-fg-strong)" },
  ".cm-activeLine": { backgroundColor: "transparent", boxShadow: "inset 0 0 0 1px var(--editor-active-line)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--editor-selection) !important",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--editor-match)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: "var(--editor-match)", outline: "1px solid var(--editor-bracket-outline)" },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--editor-gutter)", padding: "0 2px" },
  ".cm-foldPlaceholder": { background: "var(--surface-3)", border: "none", color: "var(--text-2)", padding: "0 6px", borderRadius: "4px" },
  ".cm-tooltip": { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--text-1)", boxShadow: "var(--shadow-lg)", overflow: "hidden" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "12.5px", maxHeight: "18em" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px !important" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { background: "var(--accent-soft)", color: "var(--text-1)" },
  ".cm-completionDetail": { color: "var(--text-3)", fontStyle: "normal", marginLeft: "12px" },
  ".cm-completionInfo": { padding: "8px 10px", maxWidth: "380px", fontSize: "12px" },
  ".cm-panels": { backgroundColor: "var(--surface-2)", color: "var(--text-1)", borderColor: "var(--border)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-search": { fontFamily: "var(--font-ui)", fontSize: "12.5px", padding: "8px 10px" },
  ".cm-search input, .cm-search button, .cm-search label": { fontSize: "12.5px" },
  ".cm-textfield": { background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-1)", padding: "3px 7px" },
  ".cm-button": { backgroundImage: "none", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-1)", padding: "3px 9px" },
  ".cm-searchMatch": { backgroundColor: "var(--editor-search)", outline: "1px solid var(--editor-search-outline)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--editor-search-current)" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--danger) 1px", textUnderlineOffset: "3px" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--warning) 1px", textUnderlineOffset: "3px" },
  ".cm-lint-marker": { width: "0.8em", height: "0.8em" },
  ".cm-diagnostic": { padding: "6px 10px", fontFamily: "var(--font-ui)", fontSize: "12.5px" },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--danger)" },
  ".cm-diagnostic-warning": { borderLeft: "3px solid var(--warning)" },
  ".cm-diagnostic-info": { borderLeft: "3px solid var(--text-3)" },
  ".cm-ai-range": { backgroundColor: "var(--ai-range)", borderRadius: "2px" },
  ".cm-gutter-lint": { width: "1em" },
});

export interface EditorHooks {
  compile: () => void;
  aiEdit: () => void;
  save: () => void;
}

export function createExtensions(path: string, wrap: boolean, hooks: EditorHooks, onUpdate: Extension): Extension[] {
  const isBib = /\.bib$/i.test(path);
  const isTex = /\.(tex|sty|cls|ltx|dtx|bbx|cbx|def|tikz)$/i.test(path);
  const custom: KeyBinding[] = [
    { key: "Mod-s", preventDefault: true, run: () => (hooks.save(), true) },
    { key: "Mod-Enter", preventDefault: true, run: () => (hooks.compile(), true) },
    { key: "Mod-k", preventDefault: true, run: () => (hooks.aiEdit(), true) },
  ];
  if (isTex) {
    custom.push({ key: "Mod-b", preventDefault: true, run: wrapWith("textbf") }, { key: "Mod-i", preventDefault: true, run: wrapWith("textit") });
  }
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter({ openText: "⌄", closedText: "›" }),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    indentUnit.of("  "),
    syntaxHighlighting(prismHighlight),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    lintGutter(),
    keymap.of([...custom, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
    wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
    isBib ? bibtexLanguage : isTex ? latexLanguage : [],
    isTex ? autocompletion({ override: [latexCompletions], icons: false, activateOnTyping: true, maxRenderedOptions: 80 }) : [],
    aiRangeField,
    flashField,
    editorTheme,
    onUpdate,
  ];
}
