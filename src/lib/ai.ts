import { create } from "zustand";
import { editorBridge } from "../editor/bridge";
import type { Chat, ChatMessage } from "./api";
import { extractPreamble } from "./latex";
import { CHAT_SYSTEM_PROMPT, EDIT_SYSTEM_PROMPT, GENERATE_SYSTEM_PROMPT, streamChat, toLlmHistory, type LlmMessage, type StreamState } from "./llm";
import { useStore } from "./store";

const withCustom = (base: string) => {
  const custom = useStore.getState().config?.llm.systemPrompt?.trim();
  return custom ? `${base}\n\nAdditional instructions from the user:\n${custom}` : base;
};

export function buildEditMessages(opts: { doc: string; from: number; to: number; instruction: string; path: string }): LlmMessage[] {
  const { doc, from, to, instruction, path } = opts;
  const preamble = extractPreamble(doc);
  const before = doc.slice(Math.max(0, from - 2500), from);
  const after = doc.slice(to, to + 1000);
  if (from === to) {
    return [
      { role: "system", content: withCustom(GENERATE_SYSTEM_PROMPT) },
      {
        role: "user",
        content: [
          `File: ${path}`,
          preamble && `Preamble (reference only):\n<preamble>\n${preamble}\n</preamble>`,
          `Text before the cursor (reference only):\n<before>\n${before}\n</before>`,
          `Text after the cursor (reference only):\n<after>\n${after}\n</after>`,
          `Instruction: ${instruction}`,
          "Return only the LaTeX to insert at the cursor.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];
  }
  return [
    { role: "system", content: withCustom(EDIT_SYSTEM_PROMPT) },
    {
      role: "user",
      content: [
        `File: ${path}`,
        preamble && from > doc.indexOf("\\begin{document}") ? `Preamble (reference only):\n<preamble>\n${preamble}\n</preamble>` : "",
        `Text before the fragment (reference only):\n<before>\n${before}\n</before>`,
        `Text after the fragment (reference only):\n<after>\n${after}\n</after>`,
        `Fragment to rewrite:\n<fragment>\n${doc.slice(from, to)}\n</fragment>`,
        `Instruction: ${instruction}`,
        "Return only the rewritten fragment, without the <fragment> tags.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

/** Restores the original fragment's surrounding whitespace on the model's output. */
export function fitWhitespace(original: string, result: string) {
  const lead = /^\s*/.exec(original)![0];
  const trail = /\s*$/.exec(original)![0];
  return lead + result.replace(/<\/?fragment>/g, "").trim() + trail;
}

// ---------------------------------------------------------------------------
// Chat controller (lives outside React so streams survive UI changes)
// ---------------------------------------------------------------------------
export interface Attachment {
  kind: "selection" | "file" | "error";
  label: string;
  content: string;
}

interface ChatRuntime {
  streamingId: string | null;
  controller: AbortController | null;
  attachments: Attachment[];
  addAttachment(a: Attachment): void;
  removeAttachment(i: number): void;
  stop(): void;
}

export const useChatRuntime = create<ChatRuntime>((set, get) => ({
  streamingId: null,
  controller: null,
  attachments: [],
  addAttachment: (a) => set((s) => ({ attachments: [...s.attachments.filter((x) => x.label !== a.label), a] })),
  removeAttachment: (i) => set((s) => ({ attachments: s.attachments.filter((_, j) => j !== i) })),
  stop: () => {
    get().controller?.abort();
  },
}));

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function currentFileContext(maxChars: number) {
  const st = useStore.getState();
  const path = st.active;
  const doc = path ? st.docs[path] : undefined;
  if (!path || !doc || doc.kind !== "text") return "";
  let text = doc.content;
  if (text.length > maxChars) {
    // Keep the window around the cursor when the file is too long.
    const pos = editorBridge.path === path ? editorBridge.cursor()?.pos ?? 0 : 0;
    const start = Math.max(0, Math.min(text.length - maxChars, pos - maxChars / 2));
    text = (start > 0 ? "% … (earlier content omitted)\n" : "") + text.slice(start, start + maxChars) + (start + maxChars < doc.content.length ? "\n% … (later content omitted)" : "");
  }
  const cur = editorBridge.path === path ? editorBridge.cursor() : null;
  return `The user is editing \`${path}\`${cur ? ` (cursor at line ${cur.line})` : ""}. Current contents:\n\n\`\`\`latex\n${text}\n\`\`\``;
}

export async function sendChatMessage(text: string) {
  const st = useStore.getState();
  const runtime = useChatRuntime.getState();
  if (runtime.streamingId) return;
  const attachments = runtime.attachments;
  useChatRuntime.setState({ attachments: [] });

  let chat: Chat | undefined = st.chats.find((c) => c.id === st.activeChatId);
  if (!chat) {
    chat = { id: newId(), title: text.replace(/\s+/g, " ").slice(0, 60), messages: [], createdAt: Date.now() };
    useStore.setState({ activeChatId: chat.id, chatOpen: true });
  }
  const attachmentText = attachments.map((a) => `${a.label}:\n\`\`\`latex\n${a.content}\n\`\`\``).join("\n\n");
  const userMsg: ChatMessage = attachmentText
    ? { role: "user", content: `${text}\n\n${attachmentText}`, text, attachments: attachments.map((a) => a.label) }
    : { role: "user", content: text };
  const assistant: ChatMessage = { role: "assistant", content: "" };
  chat = { ...chat, messages: [...chat.messages, userMsg] };
  st.upsertChat({ ...chat, messages: [...chat.messages, assistant] }, false);

  const cfg = st.config?.llm;
  const project = st.project;
  const system = [
    withCustom(CHAT_SYSTEM_PROMPT),
    project ? `Project: ${project.name}. Main document: ${st.settings?.mainFile || st.settings?.detectedMain || "unknown"}.` : "",
    st.compileResult ? `Last compile: ${st.compileResult.status} with ${st.compileResult.engine}; ${st.compileResult.issues.filter((i) => i.level === "error").length} errors.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const messages: LlmMessage[] = [{ role: "system", content: system }];
  if (st.prefs.includeFileContext) {
    const ctx = currentFileContext(cfg?.contextChars ?? 12000);
    if (ctx) messages.push({ role: "system", content: ctx });
  }
  messages.push(...toLlmHistory(chat.messages));

  const controller = new AbortController();
  useChatRuntime.setState({ streamingId: chat.id, controller });
  const chatId = chat.id;
  const base = chat;
  let last: StreamState = { content: "", reasoning: "" };
  let raf = 0;
  try {
    last = await streamChat(messages, {
      signal: controller.signal,
      onUpdate: (s) => {
        last = s;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          useStore.getState().upsertChat({ ...base, messages: [...base.messages, { role: "assistant", content: last.content, reasoning: last.reasoning, model: last.model }] }, false);
        });
      },
    });
    cancelAnimationFrame(raf);
    useStore.getState().upsertChat({ ...base, messages: [...base.messages, { role: "assistant", content: last.content, reasoning: last.reasoning, model: last.model }] });
  } catch (e) {
    cancelAnimationFrame(raf);
    const aborted = controller.signal.aborted;
    const msg: ChatMessage = aborted
      ? { role: "assistant", content: last.content || "_Stopped._", reasoning: last.reasoning, model: last.model }
      : { role: "assistant", content: last.content, reasoning: last.reasoning, error: (e as Error).message };
    useStore.getState().upsertChat({ ...base, messages: [...base.messages, msg] });
  } finally {
    if (useChatRuntime.getState().streamingId === chatId) useChatRuntime.setState({ streamingId: null, controller: null });
  }
}
