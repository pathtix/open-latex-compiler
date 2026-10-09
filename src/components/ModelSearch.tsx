import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Filterable model list: type to narrow it down, ↑/↓ to move, Enter to pick.
 * The empty string stands for "Auto (first available)".
 */
export function ModelSearch({ models, value, onPick }: { models: string[]; value: string; onPick: (model: string) => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return models.filter((m) => terms.every((t) => m.toLowerCase().includes(t)));
  }, [models, query]);
  const options = query ? matches : ["", ...matches];

  // Focus once the box exists (the list may still be loading) and the popover has been placed:
  // popovers stay hidden until then, and hidden inputs cannot take focus.
  const hasBox = models.length > 0;
  useEffect(() => {
    if (!hasBox) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [hasBox]);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && index < options.length) {
      e.preventDefault();
      onPick(options[index]);
    }
  };

  return (
    <div className="model-search">
      {hasBox && (
        <label className="model-search-box">
          <Search size={13} />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Search ${models.length} model${models.length === 1 ? "" : "s"}`}
            spellCheck={false}
          />
        </label>
      )}
      <div className="model-search-list" ref={list}>
        {options.map((m, i) => (
          <button
            key={m || "auto"}
            type="button"
            data-index={i}
            className={`menu-item${i === index ? " active" : ""}`}
            onMouseMove={() => setIndex(i)}
            onClick={() => onPick(m)}
          >
            <span className="menu-icon">{m === value ? <Check size={14} /> : null}</span>
            <span className="menu-label">{m ? <span className="mono-small">{m}</span> : "Auto (first available)"}</span>
          </button>
        ))}
        {query && matches.length === 0 && <div className="empty-hint">No models match “{query}”</div>}
      </div>
    </div>
  );
}
