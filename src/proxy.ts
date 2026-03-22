import { Request, Response } from "express";
import { findUserById } from "./database.js";
import { signJwt } from "./auth.js";
import { PLAN_LIMITS } from "./limits.js";

// ─── Model Map ───
// Server-authoritative: client-sent model is ignored unless Pro user selects from whitelist.
export const MODEL_MAP: Record<string, string> = {
  free: "deepseek/deepseek-v3.2",
  pro: "google/gemini-2.5-pro",
};

// Pro users can select from these models via the extension dropdown
export const PRO_ALLOWED_MODELS = [
  "openai/gpt-5",
  "anthropic/claude-sonnet-4.5",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
];

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

// ─── Chat Proxy ───

export async function handleChatProxy(req: Request, res: Response): Promise<void> {
  const userId = req.userId || "unknown";
  const plan = req.userPlan || "free";
  const planModel = MODEL_MAP[plan] || MODEL_MAP.free;

  // Validate request body
  const { messages, tools, max_tokens, stream: clientStream, model: clientModel } = req.body || {};

  // Vision: allow client to specify a vision model for image analysis
  // Pro users can also select from the whitelist
  const VISION_MODEL = "google/gemini-2.0-flash-001";
  const model = clientModel === VISION_MODEL
    ? VISION_MODEL
    : (plan === "pro" && PRO_ALLOWED_MODELS.includes(clientModel))
      ? clientModel
      : planModel;
  const useStream = clientStream !== false; // default to true, respect explicit false
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required and must not be empty" });
    return;
  }

  if (!OPENROUTER_API_KEY) {
    console.error("[proxy-error] OPENROUTER_API_KEY not configured");
    writeSseError(res, "Server configuration error: AI proxy not available", 503);
    return;
  }

  console.log(`[proxy] userId=${userId} plan=${plan} model=${model}`);

  // Build upstream request — server-authoritative model
  const upstreamBody: Record<string, unknown> = {
    model,
    messages,
    stream: useStream,
  };
  if (tools && Array.isArray(tools) && tools.length > 0) {
    upstreamBody.tools = tools;
  }
  if (max_tokens && typeof max_tokens === "number") {
    upstreamBody.max_tokens = max_tokens;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000); // 60s timeout

    const upstreamRes = await fetch(OPENROUTER_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": process.env.BASE_URL || "http://localhost:3000",
        "X-Title": "NeuralTrace",
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text().catch(() => "Unknown upstream error");
      console.error(`[proxy-error] upstream status=${upstreamRes.status} body=${errorText.slice(0, 200)}`);
      // Set SSE headers before writing error event
      setSseHeaders(res);
      res.flushHeaders();
      writeSseError(res, `Upstream AI error`, upstreamRes.status);
      return;
    }

    // Non-streaming: return JSON directly
    if (!useStream) {
      const json = await upstreamRes.json();
      res.json(json);
      return;
    }

    if (!upstreamRes.body) {
      console.error("[proxy-error] upstream response has no body");
      setSseHeaders(res);
      res.flushHeaders();
      writeSseError(res, "Empty response from AI provider", 502);
      return;
    }

    // Set SSE headers and flush before streaming
    setSseHeaders(res);
    res.flushHeaders();

    // Pipe upstream SSE chunks to client
    const reader = (upstreamRes.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
    } catch (streamErr) {
      // Client disconnected or stream error — log but don't crash
      if (!res.writableEnded) {
        console.error(`[proxy-error] stream interrupted: ${streamErr instanceof Error ? streamErr.message : "unknown"}`);
      }
    } finally {
      res.end();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.error(`[proxy-error] ${isAbort ? "timeout" : "fetch failed"}: ${message}`);

    if (!res.headersSent) {
      setSseHeaders(res);
      res.flushHeaders();
    }
    if (!res.writableEnded) {
      writeSseError(res, isAbort ? "Request timed out" : "Failed to connect to AI provider", isAbort ? 504 : 502);
    }
  }
}

// ─── User Status ───

export async function handleUserStatus(req: Request, res: Response): Promise<void> {
  const userId = req.userId;

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = findUserById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const plan = user.plan || "free";
  const model = MODEL_MAP[plan] || MODEL_MAP.free;
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  // Include allowed models for Pro users so extension can populate dropdown
  const allowedModels = plan === "pro" ? PRO_ALLOWED_MODELS : [];

  // Stale JWT fix: if DB plan differs from JWT plan, issue a fresh token
  const response: Record<string, unknown> = { plan, model, limits, allowedModels };

  if (req.userPlan && req.userPlan !== plan) {
    const newToken = signJwt({ userId: user.id, email: user.email, plan });
    response.newToken = newToken;
    console.log(`[proxy] stale-jwt userId=${userId} jwtPlan=${req.userPlan} dbPlan=${plan} newToken=issued`);
  }

  res.json(response);
}

// ─── Helpers ───

function setSseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Nginx/Traefik: disable proxy buffering
}

function writeSseError(res: Response, message: string, status: number): void {
  if (!res.headersSent) {
    setSseHeaders(res);
    res.flushHeaders();
  }
  res.write(`data: ${JSON.stringify({ error: message, status })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}
