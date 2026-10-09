import { ChevronDown, Cpu, RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Spinner } from "./ui";

export function shortModel(id: string) {
  const base = id.split("/").pop() ?? id;
  return base.length > 26 ? base.slice(0, 24) + "…" : base;
}

export function ModelPicker({ align = "end" }: { align?: "start" | "end" }) {
  const config = useStore((s) => s.config);
  const model = config?.llm.model ?? "";
  return (
    <Menu
      align={align}
      className="model-menu"
      trigger={({ toggle, open }) => (
        <button className={`chip-btn${open ? " open" : ""}`} onClick={toggle} title="Model">
          <Cpu size={13} />
          <span>{model ? shortModel(model) : "Auto model"}</span>
          <ChevronDown size={12} />
        </button>
      )}
    >
      {(close) => <ModelList close={close} />}
    </Menu>
  );
}

function ModelList({ close }: { close: () => void }) {
  const config = useStore((s) => s.config)!;
  const [state, setState] = useState<{ loading: boolean; models: string[]; error?: string }>({ loading: true, models: [] });
  const load = () => {
    setState((s) => ({ ...s, loading: true }));
    api
      .models()
      .then((r) => setState({ loading: false, models: r.models, error: r.ok ? undefined : r.error }))
      .catch((e) => setState({ loading: false, models: [], error: e.message }));
  };
  useEffect(load, []);
  const choose = async (model: string) => {
    close();
    const next = await api.saveConfig({ llm: { ...config.llm, model } });
    useStore.getState().setConfig(next);
  };
  return (
    <>
      <MenuLabel>
        <span className="row-between">
          {useStore.getState().system?.providers[config.llm.provider]?.label ?? "Model server"}
          <button className="icon-btn tiny" onClick={load} title="Refresh">
            {state.loading ? <Spinner size={12} /> : <RefreshCw size={12} />}
          </button>
        </span>
      </MenuLabel>
      {state.error && <div className="menu-error">{state.error}</div>}
      <MenuItem checked={!config.llm.model} label="Auto (first available)" onClick={() => void choose("")} />
      <div className="menu-scroll">
        {state.models.map((m) => (
          <MenuItem key={m} checked={config.llm.model === m} label={<span className="mono-small">{m}</span>} onClick={() => void choose(m)} />
        ))}
      </div>
      {!state.loading && !state.error && state.models.length === 0 && <div className="menu-error">No models found. Load one in LM Studio.</div>}
      <MenuSeparator />
      <MenuItem icon={<Settings2 size={14} />} label="AI settings…" onClick={() => (close(), useStore.getState().setDialog({ kind: "settings", tab: "ai" }))} />
    </>
  );
}
