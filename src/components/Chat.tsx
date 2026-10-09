import { ArrowUp, Check, ChevronDown, ChevronRight, Copy, FileText, History, MessageSquarePlus, Minus, Plus, Replace, Square, TextCursorInput, TextSelect, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { editorBridge } from "../editor/bridge";
import { sendChatMessage, useChatRuntime } from "../lib/ai";
import { api, type ChatMessage } from "../lib/api";
import { flatten, useStore } from "../lib/store";
import { ModelPicker } from "./ModelPicker";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "./ui";

export function ChatPanel() {
  const open = useStore((s) => s.chatOpen);
  const chat = useStore((s) => s.chats.find((c) => c.id === s.activeChatId));
  const height = useStore((s) => s.prefs.chatHeight);
  const streamingId = useChatRuntime((s) => s.streamingId);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat?.messages, open]);

  if (!open) return null;

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev: PointerEvent) => useStore.getState().setPrefs({ chatHeight: Math.min(Math.max(160, startH - (ev.clientY - startY)), window.innerHeight - 160) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="chat-panel" style={{ height }}>
      <div className="chat-resize" onPointerDown={startResize} />
      <div className="chat-head">
        <span className="chat-title">{chat?.title || "New chat"}</span>
        <div className="grow" />
        <button className="icon-btn" title="New chat" onClick={() => useStore.getState().newChat()}>
          <MessageSquarePlus size={15} />
        </button>
        <button className="icon-btn" title="Chat history" onClick={() => useStore.setState({ sidebarTab: "chats", prefs: { ...useStore.getState().prefs, sidebarOpen: true } })}>
          <History size={15} />
        </button>
        <button className="icon-btn" title="Minimize" onClick={() => useStore.setState({ chatOpen: false })}>
          <Minus size={15} />
        </button>
      </div>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!chat?.messages.length && (
          <div className="chat-empty">
            <div className="chat-empty-title">Ask your local model</div>
            <div className="chat-empty-sub">It sees the file you are editing. Ask it to draft a section, explain an error, or restructure an argument.</div>
            <div className="chat-suggestions">
              {["Summarise this document in 3 sentences", "Suggest a better title", "Find unclear sentences in this section", "Write a related-work paragraph outline"].map((s) => (
                <button key={s} className="chip" onClick={() => void sendChatMessage(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat?.messages.map((m, i) => (
          <Message key={i} msg={m} streaming={streamingId === chat.id && i === chat.messages.length - 1 && m.role === "assistant"} />
        ))}
      </div>
    </div>
  );
}

function Message({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) {
  const [showReasoning, setShowReasoning] = useState(false);
  if (msg.role === "user") {
    return (
      <div className="msg user">
        <div className="bubble">
          {msg.text ?? msg.content}
          {msg.attachments?.map((a) => (
            <div key={a} className="msg-attach-note">
              <TextSelect size={11} /> {a}
            </div>
          ))}
        </div>
      </div>
    );
  }
  const thinking = streaming && !msg.content && !!msg.reasoning;
  return (
    <div className="msg assistant">
      {(msg.reasoning || thinking) && (
        <button className="ai-thinking" onClick={() => setShowReasoning(!showReasoning)}>
          {showReasoning ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {thinking ? <span className="shimmer">Thinking…</span> : "Reasoning"}
        </button>
      )}
      {showReasoning && msg.reasoning && <pre className="ai-reasoning">{msg.reasoning}</pre>}
      {streaming && !msg.content && !msg.reasoning && <div className="shimmer muted">Waiting for the model…</div>}
      {msg.content && (
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: ({ children }) => <>{children}</>, code: CodeBlock }}>
            {msg.content}
          </ReactMarkdown>
        </div>
      )}
      {msg.error && <div className="ai-error">{msg.error}</div>}
      {!streaming && msg.model && <div className="msg-model">{msg.model}</div>}
    </div>
  );
}

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const text = String(children ?? "").replace(/\n$/, "");
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];
  const [copied, setCopied] = useState(false);
  if (!lang && !text.includes("\n")) return <code>{children}</code>;
  const hasSelection = !!editorBridge.selection();
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang ?? "code"}</span>
        <div className="grow" />
        <button className="code-action" title="Insert at cursor" onClick={() => insertIntoEditor(text, false)}>
          <TextCursorInput size={13} /> Insert
        </button>
        <button className="code-action" title="Replace the selection in the editor" disabled={!hasSelection} onClick={() => insertIntoEditor(text, true)}>
          <Replace size={13} /> Replace
        </button>
        <button
          className="code-action"
          title="Copy"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

function insertIntoEditor(text: string, replace: boolean) {
  const st = useStore.getState();
  if (!editorBridge.view) {
    st.toast("Open a text file in the editor first", "error");
    return;
  }
  if (!replace) {
    const v = editorBridge.view;
    const pos = v.state.selection.main.head;
    v.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, scrollIntoView: true, userEvent: "input.paste" });
    v.focus();
  } else editorBridge.insert(text);
  st.toast("Inserted into " + (editorBridge.path ?? "editor"), "success");
}

export function ChatInput() {
  const [text, setText] = useState("");
  const streamingId = useChatRuntime((s) => s.streamingId);
  const attachments = useChatRuntime((s) => s.attachments);
  const includeFile = useStore((s) => s.prefs.includeFileContext);
  const active = useStore((s) => s.active);
  const pending = useStore((s) => s.pendingChatPrompt);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!pending) return;
    useStore.setState({ pendingChatPrompt: undefined });
    void sendChatMessage(pending.text);
  }, [pending]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        const sel = editorBridge.selection();
        if (sel) useChatRuntime.getState().addAttachment({ kind: "selection", label: `Selection from ${editorBridge.path}`, content: sel.text });
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = () => {
    const t = text.trim();
    if (!t || streamingId) return;
    setText("");
    if (ref.current) ref.current.style.height = "auto";
    void sendChatMessage(t);
  };

  const tree = useStore((s) => s.tree);
  const files = useMemo(() => flatten(tree).filter((n) => n.type === "file" && /\.(tex|bib|sty|cls|txt|md)$/i.test(n.path)), [tree]);

  return (
    <div className="chat-input-wrap">
      {attachments.length > 0 && (
        <div className="attach-row">
          {attachments.map((a, i) => (
            <span key={i} className="attach-chip" title={a.content.slice(0, 400)}>
              {a.kind === "selection" ? <TextSelect size={12} /> : <FileText size={12} />}
              {a.label}
              <button onClick={() => useChatRuntime.getState().removeAttachment(i)}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-input">
        <textarea
          ref={ref}
          rows={1}
          placeholder="Ask anything"
          value={text}
          onFocus={() => {
            const st = useStore.getState();
            if (!st.chatOpen && st.activeChatId) useStore.setState({ chatOpen: true });
          }}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Menu
          align="end"
          trigger={({ toggle }) => (
            <button className="icon-btn" title="Add context" onClick={toggle}>
              <Plus size={17} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                checked={includeFile}
                label={`Include current file${active ? ` (${active.split("/").pop()})` : ""}`}
                onClick={() => useStore.getState().setPrefs({ includeFileContext: !includeFile })}
              />
              <MenuItem
                icon={<TextSelect size={14} />}
                label="Attach editor selection"
                hint="⌘L"
                onClick={() => {
                  close();
                  const sel = editorBridge.selection();
                  if (sel) useChatRuntime.getState().addAttachment({ kind: "selection", label: `Selection from ${editorBridge.path}`, content: sel.text });
                  else useStore.getState().toast("Select some text in the editor first");
                }}
              />
              <MenuSeparator />
              <MenuLabel>Attach a file</MenuLabel>
              <div className="menu-scroll">
                {files.map((f) => (
                  <MenuItem
                    key={f.path}
                    icon={<FileText size={14} />}
                    label={f.path}
                    onClick={async () => {
                      close();
                      const st = useStore.getState();
                      const content = st.docs[f.path]?.content || (await api.readFile(st.project!.id, f.path));
                      useChatRuntime.getState().addAttachment({ kind: "file", label: f.path, content: content.slice(0, 40000) });
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </Menu>
        <ModelPicker />
        {streamingId ? (
          <button className="send-btn" title="Stop" onClick={() => useChatRuntime.getState().stop()}>
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button className="send-btn" title="Send" disabled={!text.trim()} onClick={send}>
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
