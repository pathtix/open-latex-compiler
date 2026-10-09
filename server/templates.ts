export interface Template {
  id: string;
  name: string;
  description: string;
  files: Record<string, string>;
}

const article = String.raw`\documentclass[11pt]{article}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath, amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage[numbers]{natbib}
\usepackage{hyperref}

\title{An Article Title}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
A short summary of the work, its method and its main result.
\end{abstract}

\section{Introduction}
\label{sec:intro}
Start writing here. Cite related work like this~\cite{knuth1984texbook}
and refer to sections with Section~\ref{sec:method}.

\section{Method}
\label{sec:method}
Inline math such as $e^{i\pi} + 1 = 0$ sits in the text, while display
math gets its own line:
\begin{equation}
  \label{eq:gauss}
  \int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}.
\end{equation}

\section{Results}
Table~\ref{tab:results} summarises the numbers.

\begin{table}[h]
  \centering
  \begin{tabular}{lrr}
    \toprule
    Method   & Accuracy & Time (ms) \\
    \midrule
    Baseline & 0.81     & 120       \\
    Ours     & 0.87     & 95        \\
    \bottomrule
  \end{tabular}
  \caption{Example results.}
  \label{tab:results}
\end{table}

\section{Conclusion}
Wrap up the contribution and outline future work.

\bibliographystyle{plainnat}
\bibliography{references}

\end{document}
`;

const references = String.raw`@book{knuth1984texbook,
  author    = {Donald E. Knuth},
  title     = {The {\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984}
}

@book{lamport1994latex,
  author    = {Leslie Lamport},
  title     = {{\LaTeX}: A Document Preparation System},
  publisher = {Addison-Wesley},
  edition   = {2},
  year      = {1994}
}
`;

const blank = String.raw`\documentclass[11pt]{article}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{hyperref}

\title{Untitled}
\author{}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}
Hello, \LaTeX!

\end{document}
`;

const xelatex = String.raw`% !TEX program = xelatex
\documentclass[11pt]{article}

\usepackage{fontspec}
\usepackage{polyglossia}
\setmainlanguage{english}
\setotherlanguage{turkish}
\usepackage{amsmath}
\usepackage{unicode-math}
\usepackage{hyperref}

% System fonts work directly with XeLaTeX / LuaLaTeX:
% \setmainfont{Times New Roman}

\title{A Unicode Document}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle

\section{Unicode text}
XeLaTeX reads UTF-8 natively, so accented and non-Latin text needs no
special commands: ğüşıöç ĞÜŞİÖÇ, café, naïve, Ελληνικά.

\begin{turkish}
Türkçe metin de doğrudan yazılabilir.
\end{turkish}

\section{Unicode math}
With \texttt{unicode-math} you can type symbols directly: $α + β = γ$,
$∑_{i=1}^{n} i = \frac{n(n+1)}{2}$.

\end{document}
`;

const beamer = String.raw`\documentclass{beamer}

\usetheme{metropolis}
\usepackage{booktabs}

\title{Presentation Title}
\subtitle{A subtitle}
\author{Your Name}
\institute{Your Institution}
\date{\today}

\begin{document}

\maketitle

\begin{frame}{Outline}
  \tableofcontents
\end{frame}

\section{Motivation}

\begin{frame}{Why this matters}
  \begin{itemize}
    \item First point
    \item<2-> Revealed on the second click
    \item<3-> And the third
  \end{itemize}
\end{frame}

\section{Results}

\begin{frame}{An equation}
  \[
    \mathcal{L}(\theta) = -\sum_{i=1}^{N} \log p_\theta(y_i \mid x_i)
  \]
\end{frame}

\begin{frame}{A table}
  \centering
  \begin{tabular}{lr}
    \toprule
    Model & Score \\
    \midrule
    A & 0.81 \\
    B & 0.87 \\
    \bottomrule
  \end{tabular}
\end{frame}

\begin{frame}[standout]
  Questions?
\end{frame}

\end{document}
`;

const ieee = String.raw`\documentclass[conference]{IEEEtran}

\usepackage{cite}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{hyperref}

\begin{document}

\title{Paper Title}

\author{\IEEEauthorblockN{First Author}
\IEEEauthorblockA{\textit{Department} \\
\textit{University}\\
City, Country \\
email@example.com}
}

\maketitle

\begin{abstract}
This document is a template for an IEEE conference paper.
\end{abstract}

\begin{IEEEkeywords}
keyword one, keyword two, keyword three
\end{IEEEkeywords}

\section{Introduction}
Introduce the problem and cite prior work~\cite{knuth1984texbook}.

\section{Related Work}
Summarise the most relevant approaches.

\section{Method}
Describe the approach.

\section{Experiments}
Report the results.

\section{Conclusion}
Summarise the contributions.

\bibliographystyle{IEEEtran}
\bibliography{references}

\end{document}
`;

const report = String.raw`\documentclass[12pt,a4paper]{report}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{setspace}
\usepackage{hyperref}
\onehalfspacing

\title{Thesis Title}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle
\tableofcontents

\include{chapters/introduction}
\include{chapters/background}

\bibliographystyle{plain}
\bibliography{references}

\end{document}
`;

export const templates: Template[] = [
  { id: "article", name: "Article", description: "Article with math, a table and a BibTeX bibliography", files: { "main.tex": article, "references.bib": references } },
  { id: "blank", name: "Blank", description: "A minimal document", files: { "main.tex": blank } },
  { id: "xelatex", name: "Unicode (XeLaTeX)", description: "fontspec, polyglossia and unicode-math", files: { "main.tex": xelatex } },
  { id: "ieee", name: "IEEE conference paper", description: "IEEEtran two-column conference format", files: { "main.tex": ieee, "references.bib": references } },
  { id: "beamer", name: "Presentation (Beamer)", description: "Slides with the metropolis theme", files: { "main.tex": beamer } },
  {
    id: "report",
    name: "Thesis / report",
    description: "Report class split into chapter files",
    files: {
      "main.tex": report,
      "chapters/introduction.tex": "\\chapter{Introduction}\n\\label{ch:intro}\n\nThe opening chapter.\n",
      "chapters/background.tex": "\\chapter{Background}\n\\label{ch:background}\n\nRelated work, as discussed by~\\cite{lamport1994latex}.\n",
      "references.bib": references,
    },
  },
];

export const welcomeProject: Record<string, string> = {
  "main.tex": article
    .replace("An Article Title", "Welcome to Open LaTeX Compiler")
    .replace(
      "Start writing here.",
      String.raw`This project lives in your local workspace and compiles with your own
\TeX{} installation. A few things to try:
\begin{itemize}
  \item Press \texttt{Cmd/Ctrl+S} or \texttt{Cmd/Ctrl+Enter} to compile.
  \item Double-click the PDF to jump to the matching source line, or use
        \emph{Go to PDF} to jump the other way.
  \item Select some text and press \texttt{Cmd/Ctrl+K} to rewrite it with a
        local model served by LM Studio.
  \item Switch between pdf\LaTeX, Xe\LaTeX{} and Lua\LaTeX{} from the compile menu.
\end{itemize}
Start writing here.`,
    ),
  "references.bib": references,
};
