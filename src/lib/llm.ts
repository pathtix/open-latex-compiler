import type { ChatMessage } from "./api";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamState {
  content: string;
  reasoning: string;
  model?: string;
}

/** Separates `<think>…</think>` blocks that some local models emit inline. */
export function splitThinking(raw: string): { content: string; reasoning: string } {
  const open = raw.indexOf("<think>");
  const close = raw.indexOf("</think>");
  if (open !== -1 && raw.slice(0, open).trim() === "") {
    if (close === -1) return { reasoning: raw.slice(open + 7), content: "" };
    return { reasoning: raw.slice(open + 7, close), content: raw.slice(close + 8).replace(/^\s+/, "") };
  }
  if (open === -1 && close !== -1) {
    return { reasoning: raw.slice(0, close), content: raw.slice(close + 8).replace(/^\s+/, "") };
  }
  return { content: raw, reasoning: "" };
}

export async function streamChat(
  messages: LlmMessage[],
  opts: { model?: string; temperature?: number; maxTokens?: number; reasoningEffort?: string; signal?: AbortSignal; onUpdate?: (s: StreamState) => void } = {},
): Promise<StreamState> {
  const res = await fetch("/api/llm/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      model: opts.model || undefined,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      reasoningEffort: opts.reasoningEffort,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  const model = decodeURIComponent(res.headers.get("X-Model") ?? "") || undefined;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawContent = "";
  let reasoningField = "";
  const emit = () => {
    const split = splitThinking(rawContent);
    const state = { content: split.content, reasoning: reasoningField + split.reasoning, model };
    opts.onUpdate?.(state);
    return state;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) throw new Error(typeof json.error === "string" ? json.error : json.error.message ?? "Model error");
      const delta = json.choices?.[0]?.delta ?? {};
      if (typeof delta.reasoning_content === "string") reasoningField += delta.reasoning_content;
      else if (typeof delta.reasoning === "string") reasoningField += delta.reasoning;
      if (typeof delta.content === "string") rawContent += delta.content;
      emit();
    }
  }
  return emit();
}

/** Removes a wrapping Markdown code fence, which models often add despite instructions. */
export function stripFences(text: string) {
  const t = text.trim();
  const m = /^```[\w-]*\s*\n([\s\S]*?)\n?```\s*$/.exec(t);
  if (m) return m[1];
  // An unterminated fence while streaming.
  const open = /^```[\w-]*\s*\n([\s\S]*)$/.exec(t);
  if (open && !open[1].includes("```")) return open[1];
  return text;
}

export function toLlmHistory(messages: ChatMessage[]): LlmMessage[] {
  return messages.filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: m.content }));
}

export const EDIT_SYSTEM_PROMPT = `You are an expert LaTeX author and editor embedded in a LaTeX editor.
You will receive a fragment of a LaTeX document and an instruction.
Return ONLY the LaTeX that should replace the fragment — no explanations, no preamble, no Markdown code fences.
Rules:
- Preserve all LaTeX commands, \\label, \\ref, \\cite keys, math and environments unless the instruction asks to change them.
- Keep the language of the original text unless asked to translate.
- Only use packages that are already loaded in the preamble, unless the instruction requires otherwise.
- Escape special characters (%, &, #, _, $) correctly in text.`;

export const GENERATE_SYSTEM_PROMPT = `You are an expert LaTeX author embedded in a LaTeX editor.
Write LaTeX that will be inserted at the user's cursor position, following the instruction.
Return ONLY the LaTeX to insert — no explanations and no Markdown code fences.
Match the surrounding document's style, language and loaded packages. Do not repeat the preamble or \\begin{document}.`;

export const CHAT_SYSTEM_PROMPT = `You are a helpful writing and LaTeX assistant inside a local LaTeX editor.
Help the user write, restructure and debug their document. When you propose LaTeX, put it in a fenced \`\`\`latex code block so the user can insert it.
Be concise. Use only packages available in standard TeX Live unless asked.`;
