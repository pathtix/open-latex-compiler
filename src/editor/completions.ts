import { snippet, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { flatten, useStore } from "../lib/store";

// [label, snippet template (without the backslash), detail]
const COMMANDS: [string, string, string][] = [
  ["section", "section{${title}}", "sectioning"],
  ["section*", "section*{${title}}", "unnumbered section"],
  ["subsection", "subsection{${title}}", "sectioning"],
  ["subsection*", "subsection*{${title}}", "unnumbered"],
  ["subsubsection", "subsubsection{${title}}", "sectioning"],
  ["paragraph", "paragraph{${title}}", "sectioning"],
  ["chapter", "chapter{${title}}", "sectioning"],
  ["part", "part{${title}}", "sectioning"],
  ["label", "label{${key}}", "cross-reference"],
  ["ref", "ref{${key}}", "cross-reference"],
  ["eqref", "eqref{${key}}", "equation reference"],
  ["autoref", "autoref{${key}}", "hyperref"],
  ["cref", "cref{${key}}", "cleveref"],
  ["Cref", "Cref{${key}}", "cleveref"],
  ["pageref", "pageref{${key}}", "cross-reference"],
  ["cite", "cite{${key}}", "citation"],
  ["citep", "citep{${key}}", "natbib"],
  ["citet", "citet{${key}}", "natbib"],
  ["parencite", "parencite{${key}}", "biblatex"],
  ["textcite", "textcite{${key}}", "biblatex"],
  ["autocite", "autocite{${key}}", "biblatex"],
  ["footnote", "footnote{${text}}", "footnote"],
  ["textbf", "textbf{${text}}", "bold"],
  ["textit", "textit{${text}}", "italic"],
  ["emph", "emph{${text}}", "emphasis"],
  ["underline", "underline{${text}}", "underline"],
  ["texttt", "texttt{${text}}", "monospace"],
  ["textsc", "textsc{${text}}", "small caps"],
  ["textsf", "textsf{${text}}", "sans serif"],
  ["url", "url{${url}}", "hyperref"],
  ["href", "href{${url}}{${text}}", "hyperref"],
  ["includegraphics", "includegraphics[width=${0.8}\\linewidth]{${file}}", "graphicx"],
  ["input", "input{${file}}", "include file"],
  ["include", "include{${file}}", "include file"],
  ["usepackage", "usepackage{${package}}", "preamble"],
  ["documentclass", "documentclass{${article}}", "preamble"],
  ["newcommand", "newcommand{\\${name}}[${1}]{${definition}}", "macro"],
  ["renewcommand", "renewcommand{\\${name}}{${definition}}", "macro"],
  ["title", "title{${title}}", "front matter"],
  ["author", "author{${name}}", "front matter"],
  ["date", "date{${\\today}}", "front matter"],
  ["maketitle", "maketitle", "front matter"],
  ["tableofcontents", "tableofcontents", "toc"],
  ["listoffigures", "listoffigures", "toc"],
  ["listoftables", "listoftables", "toc"],
  ["bibliography", "bibliography{${references}}", "bibtex"],
  ["bibliographystyle", "bibliographystyle{${plain}}", "bibtex"],
  ["addbibresource", "addbibresource{${references.bib}}", "biblatex"],
  ["printbibliography", "printbibliography", "biblatex"],
  ["caption", "caption{${text}}", "float"],
  ["centering", "centering", "alignment"],
  ["item", "item ${}", "list"],
  ["frac", "frac{${num}}{${den}}", "math"],
  ["dfrac", "dfrac{${num}}{${den}}", "math"],
  ["sqrt", "sqrt{${x}}", "math"],
  ["sum", "sum_{${i=1}}^{${n}}", "math"],
  ["prod", "prod_{${i=1}}^{${n}}", "math"],
  ["int", "int_{${a}}^{${b}}", "math"],
  ["lim", "lim_{${x \\to \\infty}}", "math"],
  ["left(", "left( ${} \\right)", "math"],
  ["left[", "left[ ${} \\right]", "math"],
  ["mathbb", "mathbb{${R}}", "math"],
  ["mathcal", "mathcal{${L}}", "math"],
  ["mathbf", "mathbf{${x}}", "math"],
  ["mathrm", "mathrm{${text}}", "math"],
  ["text", "text{${text}}", "math"],
  ["operatorname", "operatorname{${name}}", "math"],
  ["hat", "hat{${x}}", "math"],
  ["bar", "bar{${x}}", "math"],
  ["tilde", "tilde{${x}}", "math"],
  ["vec", "vec{${x}}", "math"],
  ["overline", "overline{${x}}", "math"],
  ["partial", "partial", "math"],
  ["nabla", "nabla", "math"],
  ["infty", "infty", "math"],
  ["cdot", "cdot", "math"],
  ["cdots", "cdots", "math"],
  ["ldots", "ldots", "math"],
  ["times", "times", "math"],
  ["leq", "leq", "math"],
  ["geq", "geq", "math"],
  ["neq", "neq", "math"],
  ["approx", "approx", "math"],
  ["in", "in", "math"],
  ["forall", "forall", "math"],
  ["exists", "exists", "math"],
  ["rightarrow", "rightarrow", "math"],
  ["Rightarrow", "Rightarrow", "math"],
  ["alpha", "alpha", "greek"],
  ["beta", "beta", "greek"],
  ["gamma", "gamma", "greek"],
  ["delta", "delta", "greek"],
  ["epsilon", "epsilon", "greek"],
  ["varepsilon", "varepsilon", "greek"],
  ["theta", "theta", "greek"],
  ["lambda", "lambda", "greek"],
  ["mu", "mu", "greek"],
  ["pi", "pi", "greek"],
  ["sigma", "sigma", "greek"],
  ["tau", "tau", "greek"],
  ["phi", "phi", "greek"],
  ["omega", "omega", "greek"],
  ["Delta", "Delta", "greek"],
  ["Sigma", "Sigma", "greek"],
  ["Omega", "Omega", "greek"],
  ["hline", "hline", "table"],
  ["toprule", "toprule", "booktabs"],
  ["midrule", "midrule", "booktabs"],
  ["bottomrule", "bottomrule", "booktabs"],
  ["multicolumn", "multicolumn{${2}}{${c}}{${text}}", "table"],
  ["newpage", "newpage", "layout"],
  ["clearpage", "clearpage", "layout"],
  ["noindent", "noindent", "layout"],
  ["vspace", "vspace{${1em}}", "spacing"],
  ["hspace", "hspace{${1em}}", "spacing"],
  ["linewidth", "linewidth", "length"],
  ["textwidth", "textwidth", "length"],
  ["today", "today", "date"],
  ["LaTeX", "LaTeX", "logo"],
  ["TeX", "TeX", "logo"],
];

const ENVIRONMENTS: Record<string, string> = {
  figure: "figure}[${htbp}]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${file}}\n\t\\caption{${caption}}\n\t\\label{fig:${label}}\n\\end{figure}",
  table: "table}[${htbp}]\n\t\\centering\n\t\\begin{tabular}{${lcr}}\n\t\t\\toprule\n\t\t${} \\\\\n\t\t\\midrule\n\t\t\\bottomrule\n\t\\end{tabular}\n\t\\caption{${caption}}\n\t\\label{tab:${label}}\n\\end{table}",
  tabular: "tabular}{${lcr}}\n\t${}\n\\end{tabular}",
  itemize: "itemize}\n\t\\item ${}\n\\end{itemize}",
  enumerate: "enumerate}\n\t\\item ${}\n\\end{enumerate}",
  description: "description}\n\t\\item[${term}] ${}\n\\end{description}",
  equation: "equation}\n\t${}\n\\end{equation}",
  "equation*": "equation*}\n\t${}\n\\end{equation*}",
  align: "align}\n\t${} &= ${} \\\\\n\\end{align}",
  "align*": "align*}\n\t${} &= ${} \\\\\n\\end{align*}",
  frame: "frame}{${title}}\n\t${}\n\\end{frame}",
};
const ENV_NAMES = [
  ...Object.keys(ENVIRONMENTS),
  "abstract", "document", "center", "flushleft", "flushright", "quote", "quotation", "verbatim", "minipage", "gather", "gather*",
  "multline", "split", "cases", "matrix", "pmatrix", "bmatrix", "array", "theorem", "lemma", "proof", "definition", "corollary",
  "example", "remark", "subfigure", "algorithm", "algorithmic", "lstlisting", "minted", "tikzpicture", "thebibliography", "appendix",
  "block", "columns", "column", "titlepage", "landscape", "longtable", "wrapfigure",
];

const IMAGE_EXT = /\.(png|jpe?g|pdf|eps|svg|gif)$/i;

function argStart(context: CompletionContext, re: RegExp) {
  const m = context.matchBefore(re);
  if (!m) return null;
  const brace = m.text.lastIndexOf("{");
  const comma = m.text.lastIndexOf(",");
  return { from: m.from + Math.max(brace, comma) + 1, text: m.text };
}

/** Completion apply that also swallows an auto-inserted closing brace. */
function envApply(name: string) {
  const tpl = ENVIRONMENTS[name] ?? `${name}}\n\t\${}\n\\end{${name}}`;
  const run = snippet(tpl);
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const next = view.state.sliceDoc(to, to + 1);
    run(view, completion, from, next === "}" ? to + 1 : to);
  };
}

export function latexCompletions(context: CompletionContext): CompletionResult | null {
  const store = useStore.getState();
  const symbols = store.symbols;

  const env = context.matchBefore(/\\begin\{[^}\s]*/);
  if (env) {
    const from = env.from + "\\begin{".length;
    const names = new Set([...ENV_NAMES, ...(symbols?.environments ?? [])]);
    return {
      from,
      options: [...names].map((name) => ({ label: name, type: "type", apply: envApply(name), boost: ENVIRONMENTS[name] ? 1 : 0 })),
      validFor: /^[\w*]*$/,
    };
  }

  const end = context.matchBefore(/\\end\{[^}\s]*/);
  if (end) {
    // Suggest the innermost unclosed environment first.
    const before = context.state.sliceDoc(Math.max(0, context.pos - 20000), context.pos);
    const stack: string[] = [];
    for (const m of before.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
      if (m[1] === "begin") stack.push(m[2]);
      else if (stack[stack.length - 1] === m[2]) stack.pop();
    }
    const open = stack.reverse();
    return {
      from: end.from + "\\end{".length,
      options: [...new Set([...open, ...ENV_NAMES])].map((name, i) => ({ label: name, type: "type", boost: i < open.length ? 10 - i : 0 })),
      validFor: /^[\w*]*$/,
    };
  }

  const ref = argStart(context, /\\(?:[a-zA-Z]*ref|[cC]ref|autoref|nameref)\*?\{[^}]*/);
  if (ref) {
    return {
      from: ref.from,
      options: (symbols?.labels ?? []).map((l) => ({ label: l.key, type: "variable", detail: `${l.file}:${l.line}`, info: l.context })),
      validFor: /^[^,}]*$/,
    };
  }

  const cite = argStart(context, /\\[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\]){0,2}\{[^}]*/);
  if (cite) {
    return {
      from: cite.from,
      options: (symbols?.citations ?? []).map((c) => ({
        label: c.key,
        type: "text",
        detail: c.type,
        info: [c.title, c.author].filter(Boolean).join(" — "),
      })),
      validFor: /^[^,}]*$/,
    };
  }

  const fileArg = context.matchBefore(/\\(includegraphics|input|include|subfile|bibliography|addbibresource|includepdf)(?:\[[^\]]*\])?\{[^}]*/);
  if (fileArg) {
    const cmd = /^\\(\w+)/.exec(fileArg.text)![1];
    const from = fileArg.from + fileArg.text.lastIndexOf("{") + 1;
    const files = flatten(store.tree).filter((n) => n.type === "file").map((n) => n.path);
    let options: Completion[];
    if (cmd === "includegraphics" || cmd === "includepdf") options = files.filter((f) => IMAGE_EXT.test(f)).map((f) => ({ label: f, type: "constant" }));
    else if (cmd === "bibliography") options = files.filter((f) => f.endsWith(".bib")).map((f) => ({ label: f.replace(/\.bib$/, ""), type: "constant" }));
    else if (cmd === "addbibresource") options = files.filter((f) => f.endsWith(".bib")).map((f) => ({ label: f, type: "constant" }));
    else options = files.filter((f) => f.endsWith(".tex")).map((f) => ({ label: f.replace(/\.tex$/, ""), type: "constant" }));
    return { from, options, validFor: /^[^}]*$/ };
  }

  const cmd = context.matchBefore(/\\[a-zA-Z@]*\*?/);
  if (!cmd || (cmd.from === cmd.to && !context.explicit)) return null;
  const custom = (symbols?.commands ?? []).map((c) =>
    c.args > 0
      ? snippetCompletion(`\\${c.name}${"{${}}".repeat(c.args)}`, { label: `\\${c.name}`, type: "function", detail: "custom" })
      : { label: `\\${c.name}`, type: "function", detail: "custom" },
  );
  const builtin = COMMANDS.map(([label, tpl, detail]) => snippetCompletion(`\\${tpl}`, { label: `\\${label}`, type: detail === "greek" || detail === "math" ? "constant" : "keyword", detail }));
  const envs = [snippetCompletion("\\begin{${env}}\n\t${}\n\\end{${env}}", { label: "\\begin", type: "keyword", detail: "environment" })];
  return { from: cmd.from, options: [...envs, ...builtin, ...custom], validFor: /^\\[a-zA-Z@]*\*?$/ };
}
