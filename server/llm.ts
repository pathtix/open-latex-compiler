import type { Request, Response } from "express";
import { loadConfig } from "./config.ts";

export const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string }> = {
  lmstudio: { label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  llamacpp: { label: "llama.cpp server", baseUrl: "http://localhost:8080/v1" },
  vllm: { label: "vLLM", baseUrl: "http://localhost:8000/v1" },
  jan: { label: "Jan", baseUrl: "http://localhost:1337/v1" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  custom: { label: "Custom (OpenAI-compatible)", baseUrl: "" },
};

/**
 * OpenAI-compatible servers serve their API under /v1. LM Studio shows its address without it
 * ("Reachable at http://localhost:1234"), so a base URL with no path gets /v1 added.
 */
export function apiBase(url: string) {
  const trimmed = url.trim().replace(/\/+$/, "");
  try {
    if (new URL(trimmed).pathname === "/") return `${trimmed}/v1`;
  } catch {}
  return trimmed;
}

function headers(apiKey: string) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function unreachable(baseUrl: string, err: unknown) {
  const cause = err instanceof Error ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
  const reason = cause?.code || cause?.message || (err instanceof Error ? err.message : String(err)) || "connection failed";
  return `Could not reach the model server at ${baseUrl} (${reason}). Start the local server in LM Studio (Developer → Start Server) or change the endpoint in Settings → AI.`;
}

export async function listModels(override?: { baseUrl?: string; apiKey?: string }) {
  const cfg = loadConfig().llm;
  const baseUrl = apiBase(override?.baseUrl || cfg.baseUrl);
  const apiKey = override?.apiKey ?? cfg.apiKey;
  let res: globalThis.Response;
  try {
    res = await fetch(`${baseUrl}/models`, { headers: headers(apiKey), signal: AbortSignal.timeout(6000) });
  } catch (err) {
    return { ok: false as const, error: unreachable(baseUrl, err), models: [] as string[] };
  }
  if (!res.ok) return { ok: false as const, error: `Model server responded ${res.status} ${res.statusText}`, models: [] as string[] };
  const body = (await res.json().catch(() => ({}))) as { data?: { id: string; type?: string }[]; error?: unknown };
  // LM Studio answers unknown paths with 200 and an error body, so check the shape too.
  if (!Array.isArray(body.data)) {
    const detail = typeof body.error === "string" ? body.error : (body.error as { message?: string } | undefined)?.message;
    return { ok: false as const, error: `${baseUrl}/models did not return a model list${detail ? ` (${detail})` : ""}. Check the endpoint in Settings → AI.`, models: [] as string[] };
  }
  const models = body.data
    .filter((m) => !/embed/i.test(m.id) && m.type !== "embeddings")
    .map((m) => m.id);
  return { ok: true as const, models };
}

interface ChatBody {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
}

/** Streams an OpenAI-compatible chat completion straight through to the browser as SSE. */
export async function proxyChat(req: Request, res: Response) {
  const cfg = loadConfig().llm;
  const body = req.body as ChatBody;
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    res.status(400).json({ error: "messages is required" });
    return;
  }
  const baseUrl = apiBase(cfg.baseUrl);
  let model = body.model || cfg.model;
  if (!model) {
    const listed = await listModels();
    if (!listed.ok) {
      res.status(502).json({ error: listed.error });
      return;
    }
    model = listed.models[0];
    if (!model) {
      res.status(502).json({ error: "The model server has no models available. Download or load a model in LM Studio first." });
      return;
    }
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  const payload: Record<string, unknown> = {
    model,
    messages: body.messages,
    stream: true,
    temperature: body.temperature ?? cfg.temperature,
    max_tokens: body.maxTokens ?? cfg.maxTokens,
  };
  const effort = body.reasoningEffort ?? cfg.reasoningEffort;
  if (effort) payload.reasoning_effort = effort;

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(cfg.apiKey),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    if (!controller.signal.aborted) res.status(502).json({ error: unreachable(baseUrl, err) });
    return;
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    let message = text;
    try {
      const j = JSON.parse(text);
      message = j.error?.message ?? j.error ?? j.message ?? text;
    } catch {}
    res.status(502).json({ error: `Model server error ${upstream.status}: ${String(message).slice(0, 500)}` });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Model": encodeURIComponent(model),
  });
  try {
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
      res.write(chunk);
    }
  } catch (err) {
    if (!controller.signal.aborted) res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
  }
  res.end();
}
