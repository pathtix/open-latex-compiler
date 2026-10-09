import { HighlightStyle, StreamLanguage, type StringStream } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags as t } from "@lezer/highlight";

export const latexLanguage = StreamLanguage.define(stex);

interface BibState {
  depth: number;
  inEntry: boolean;
  expectKey: boolean;
}

/** Minimal BibTeX tokenizer: entry types, keys, field names, braces and comments. */
export const bibtexLanguage = StreamLanguage.define<BibState>({
  name: "bibtex",
  startState: () => ({ depth: 0, inEntry: false, expectKey: false }),
  token(stream: StringStream, state: BibState) {
    if (stream.eatSpace()) return null;
    if (!state.inEntry) {
      if (stream.match(/^@\w+/)) {
        state.inEntry = true;
        state.expectKey = true;
        return "keyword";
      }
      stream.skipToEnd();
      return "comment";
    }
    const ch = stream.peek();
    if (ch === "{" || ch === "(") {
      stream.next();
      state.depth++;
      return "bracket";
    }
    if (ch === "}" || ch === ")") {
      stream.next();
      state.depth--;
      if (state.depth <= 0) {
        state.depth = 0;
        state.inEntry = false;
      }
      return "bracket";
    }
    if (state.expectKey && state.depth === 1) {
      if (stream.match(/^[^,\s{}]+/)) {
        state.expectKey = false;
        return "atom";
      }
    }
    if (state.depth === 1) {
      if (stream.match(/^[A-Za-z][\w-]*(?=\s*=)/)) return "propertyName";
      if (stream.match(/^"[^"]*"?/)) return "string";
      if (stream.match(/^\d+/)) return "number";
      if (stream.eat("=") || stream.eat(",") || stream.eat("#")) return "operator";
    }
    if (stream.match(/^\\[A-Za-z]+/)) return "tagName";
    stream.next();
    return state.depth > 1 ? "string" : null;
  },
  languageData: { commentTokens: { line: "%" } },
});

/** Colours come from CSS variables so light and dark themes share one style. */
export const prismHighlight = HighlightStyle.define([
  { tag: [t.tagName, t.standard(t.variableName)], color: "var(--hl-command)" },
  { tag: [t.bracket, t.paren, t.squareBracket, t.brace], color: "var(--hl-bracket)" },
  { tag: t.keyword, color: "var(--hl-keyword)" },
  { tag: [t.atom, t.number, t.bool], color: "var(--hl-atom)" },
  { tag: t.special(t.variableName), color: "var(--hl-math)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--hl-comment)" },
  { tag: t.string, color: "var(--hl-string)" },
  { tag: t.propertyName, color: "var(--hl-property)" },
  { tag: t.operator, color: "var(--hl-comment)" },
  { tag: t.invalid, color: "inherit" },
]);
