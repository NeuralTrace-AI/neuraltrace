import "dotenv/config";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import express, { Request, Response } from "express";
import cookieParser from "cookie-parser";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getDb, resolveDb, getVaultCount, initSystemDb, getSystemUserCount, insertTrace, deleteTrace, searchTraces, getAllTraces, getRecentTraces, getTraceCount, searchTracesFiltered, createUser, findUserByEmail, createApiKey, checkAndIncrementSearch, findUserById, updateTraceMetadata } from "./database.js";
import { getEmbedding, cosineSimilarity, recencyWeight, keywordScore, extractSuggestedTraces } from "./embeddings.js";
import { startConsolidationLoop } from "./consolidator.js";
import { generateMagicToken, sendMagicLink, validateMagicToken, signJwt, verifyJwt, validateApiKey } from "./auth.js";
import { authMiddleware, traceLimitMiddleware, searchLimitMiddleware, apiKeyLimitMiddleware } from "./middleware.js";
import { validateOAuthToken, handleOAuthDiscovery, handleClientRegistration, handleAuthorize, handleApprove, handleOAuthLogin, handleToken, handleRevoke } from "./oauth.js";
import { handleChatProxy, handleUserStatus } from "./proxy.js";
import { handleBillingWebhook, handleBillingPortal } from "./billing.js";
import { PLAN_LIMITS, UPGRADE_URL } from "./limits.js";

// --- Config ---
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const IS_CLOUD = process.env.NEURALTRACE_MODE === "cloud";
const HAS_OPENAI_KEY =
  !!process.env.OPENAI_API_KEY &&
  process.env.OPENAI_API_KEY !== "your-openai-api-key-here";

// --- Tool Registration Factory ---
function registerTools(server: McpServer, db?: import("better-sqlite3").Database, userId?: string) {
  server.tool(
    "add_trace",
    "Save a new memory, preference, or context rule to the NeuralTrace vault.",
    {
      content: z.string().describe("The memory or preference to save"),
      tags: z.string().optional().describe("Comma-separated keywords for filtering"),
    },
    async ({ content, tags }) => {
      let vector: string | undefined;

      if (HAS_OPENAI_KEY) {
        try {
          const embedding = await getEmbedding(content);
          vector = JSON.stringify(embedding);
        } catch (err) {
          console.error("[Embedding] Failed to generate:", err);
        }
      }

      const id = insertTrace(content, tags || "", vector, "raw", "mcp", db);
      return {
        content: [
          {
            type: "text" as const,
            text: `Trace saved (id: ${id}). Content: "${content}"${tags ? ` | Tags: ${tags}` : ""}${vector ? " [with embedding]" : " [keyword-only]"}`,
          },
        ],
      };
    }
  );

  server.tool(
    "search_neuraltrace_memory",
    "Search the NeuralTrace vault for relevant memories. Supports semantic search, keyword matching, tag filtering, and date ranges. Results are ranked by a hybrid score (semantic + keyword + recency).",
    {
      query: z.string().describe("Keyword or phrase to search for"),
      tags: z.string().optional().describe("Filter by tags (comma-separated). Only traces matching at least one tag are returned."),
      after: z.string().optional().describe("Only return traces created after this date (ISO 8601, e.g. 2026-03-01)"),
      before: z.string().optional().describe("Only return traces created before this date (ISO 8601, e.g. 2026-03-07)"),
    },
    async ({ query, tags, after, before }) => {
      // MCP search rate limiting (cloud mode only)
      if (userId && IS_CLOUD) {
        const user = findUserById(userId);
        const plan = user?.plan || "free";
        if (plan !== "pro") {
          const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
          const result = checkAndIncrementSearch(userId, limits.searches);
          console.log(`[rate-limit] type=search userId=${userId} plan=${plan} current=${result.current} limit=${result.limit} blocked=${!result.allowed}`);
          if (!result.allowed) {
            return {
              content: [{
                type: "text" as const,
                text: `Daily search limit reached (${result.current}/${result.limit}). Upgrade to Pro for unlimited searches: ${UPGRADE_URL}`,
              }],
            };
          }
        }
      }

      const SEMANTIC_WEIGHT = 0.7;
      const KEYWORD_WEIGHT = 0.3;
      const limit = 10;

      // Get candidate traces (with optional filters)
      const candidates = (tags || after || before)
        ? searchTracesFiltered({ tags, after, before, limit: 200 }, db)
        : getAllTraces(db);

      if (candidates.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No traces found matching filters.` }],
        };
      }

      // Score each candidate
      type ScoredTrace = {
        id: number;
        content: string;
        tags: string | null;
        created_at: string;
        semanticScore: number;
        kwScore: number;
        recency: number;
        finalScore: number;
      };

      let scored: ScoredTrace[];

      if (HAS_OPENAI_KEY) {
        try {
          const queryVector = await getEmbedding(query);

          scored = candidates.map((t) => {
            const sem = t.vector
              ? cosineSimilarity(queryVector, JSON.parse(t.vector) as number[])
              : 0;
            const kw = keywordScore(t.content, t.tags, query);
            const rec = recencyWeight(t.created_at);
            const finalScore = rec * (SEMANTIC_WEIGHT * sem + KEYWORD_WEIGHT * kw);
            return {
              id: t.id,
              content: t.content,
              tags: t.tags,
              created_at: t.created_at,
              semanticScore: sem,
              kwScore: kw,
              recency: rec,
              finalScore,
            };
          });
        } catch (err) {
          console.error("[Search] Semantic search failed, using keyword-only:", err);
          scored = candidates.map((t) => {
            const kw = keywordScore(t.content, t.tags, query);
            const rec = recencyWeight(t.created_at);
            return {
              id: t.id, content: t.content, tags: t.tags, created_at: t.created_at,
              semanticScore: 0, kwScore: kw, recency: rec,
              finalScore: rec * KEYWORD_WEIGHT * kw,
            };
          });
        }
      } else {
        scored = candidates.map((t) => {
          const kw = keywordScore(t.content, t.tags, query);
          const rec = recencyWeight(t.created_at);
          return {
            id: t.id, content: t.content, tags: t.tags, created_at: t.created_at,
            semanticScore: 0, kwScore: kw, recency: rec,
            finalScore: rec * KEYWORD_WEIGHT * kw,
          };
        });
      }

      // Filter out zero-score results and sort
      const results = scored
        .filter((r) => r.finalScore > 0.01)
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, limit);

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No traces found matching "${query}".` }],
        };
      }

      const formatted = results
        .map(
          (r) =>
            `[${r.id}] (score: ${r.finalScore.toFixed(3)}) ${r.content}${r.tags ? ` (tags: ${r.tags})` : ""} — ${r.created_at}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${results.length} trace(s) for "${query}":\n\n${formatted}`,
          },
        ],
      };
    }
  );

  server.tool(
    "suggest_traces",
    "Analyze a conversation summary and suggest memories worth saving. Returns proposed traces for the user to approve before saving. Call this at the end of substantial conversations.",
    {
      conversation_summary: z
        .string()
        .describe("A summary of the conversation including key decisions, preferences, and patterns observed"),
    },
    async ({ conversation_summary }) => {
      if (!HAS_OPENAI_KEY) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Auto-suggest requires an OpenAI API key for extraction. Please set OPENAI_API_KEY.",
            },
          ],
        };
      }

      try {
        const suggestions = await extractSuggestedTraces(conversation_summary);

        if (suggestions.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No memorable decisions or preferences detected in this conversation.",
              },
            ],
          };
        }

        const formatted = suggestions
          .map(
            (s, i) =>
              `${i + 1}. "${s.content}" (tags: ${s.tags})`
          )
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `I found ${suggestions.length} memory suggestion(s) from this conversation:\n\n${formatted}\n\nTo save any of these, ask the user which ones to keep, then call add_trace for each approved suggestion.`,
            },
          ],
        };
      } catch (err) {
        console.error("[Suggest] Extraction failed:", err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to extract suggestions: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "delete_trace",
    "Delete a trace from the NeuralTrace vault by its ID.",
    {
      id: z.number().describe("The ID of the trace to delete"),
    },
    async ({ id }) => {
      const deleted = deleteTrace(id, db);
      return {
        content: [
          {
            type: "text" as const,
            text: deleted
              ? `Trace ${id} deleted successfully.`
              : `Trace ${id} not found.`,
          },
        ],
      };
    }
  );
}

// --- Prompt Registration ---
function registerPrompts(server: McpServer, db?: import("better-sqlite3").Database) {
  server.prompt(
    "vault-context",
    "Returns recent traces from the NeuralTrace vault for context injection.",
    {},
    async () => {
      const recent = getRecentTraces(15, db);
      if (recent.length === 0) {
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: "The NeuralTrace vault is empty. No memories stored yet." },
            },
          ],
        };
      }

      const formatted = recent
        .map((r) => `- [${r.id}] ${r.content}${r.tags ? ` (tags: ${r.tags})` : ""} — ${r.created_at}`)
        .join("\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Here are the most recent memories from the NeuralTrace vault. Use these as context for the conversation:\n\n${formatted}`,
            },
          },
        ],
      };
    }
  );
}

// --- Helper: create a new MCP server with tools registered ---
const AUTO_RECALL_INSTRUCTIONS = `You have access to the user's NeuralTrace memory vault — their personal knowledge base of saved notes, bookmarks, URLs, preferences, decisions, and context from across all their AI tools and browsing sessions.

CRITICAL: The NeuralTrace vault is the user's PRIMARY memory. When they say "saved", "remembered", "bookmarked", "noted", "stored", or ask "where was", "what was", "do I have", "did I save", "I forgot", "what do I know about" — ALWAYS search the vault FIRST using search_neuraltrace_memory BEFORE checking your own memory, chat history, or asking for clarification. The answer is likely in their vault.

Rules:
1. Search the vault FIRST for ANY question about something the user might have previously encountered, saved, or decided — not just preferences and architecture, but also URLs, bookmarks, people, tools, resources, notes, and context.
2. When the user makes a decision worth remembering, offer to save it with add_trace.
3. Use suggest_traces at the end of substantial conversations to propose memories for the user to approve.
4. When searching, extract relevant keywords from the user's question — not the full question verbatim. Try multiple keyword variations if the first search returns no results.`;

function createMcpServer(db?: import("better-sqlite3").Database, userId?: string): McpServer {
  const s = new McpServer(
    { name: "neuraltrace", version: "1.1.0" },
    { instructions: AUTO_RECALL_INSTRUCTIONS }
  );
  registerTools(s, db, userId);
  registerPrompts(s, db);
  return s;
}

// --- Express ---
const app = express();
app.use(cookieParser());

// Session maps for concurrent clients
const sseTransports: Record<string, SSEServerTransport> = {};
const httpTransports: Record<string, { transport: StreamableHTTPServerTransport; server: McpServer }> = {};

// ─── OAuth 2.1 Routes (no auth required — OAuth handles its own auth) ───
app.get("/.well-known/oauth-authorization-server", handleOAuthDiscovery);
app.post("/oauth/register", express.json(), handleClientRegistration);
app.get("/oauth/authorize", handleAuthorize);
app.post("/oauth/approve", express.urlencoded({ extended: true }), handleApprove);
app.post("/oauth/login", express.urlencoded({ extended: true }), handleOAuthLogin);
app.get("/oauth/login", (req, res) => {
  // GET handler for magic link clicks — convert query params to body and call POST handler
  req.body = { token: req.query.token, return_url: req.query.return_url };
  handleOAuthLogin(req, res);
});
app.post("/oauth/token", express.urlencoded({ extended: true }), handleToken);
app.post("/oauth/revoke", express.urlencoded({ extended: true }), handleRevoke);

// Health check (no auth required)
app.get("/health", (_req: Request, res: Response) => {
  const info: Record<string, unknown> = {
    status: "ok",
    server: "neuraltrace",
    version: "1.1.0",
    mode: IS_CLOUD ? "cloud" : "selfhosted",
  };
  if (IS_CLOUD) {
    info.users = getSystemUserCount();
    info.vaults = getVaultCount();
  }
  res.json(info);
});

// --- Billing Routes (webhook MUST be before JSON-parsed routes — Decision #12) ---
// Webhook: raw body for Paddle signature verification, no authMiddleware
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), handleBillingWebhook);

// Portal: requires auth
app.get("/api/billing/portal", authMiddleware, handleBillingPortal);

// --- Upgrade Page (serves HTML with Paddle config injected as meta tags) ---
const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = dirname(__filename_local);

app.get("/", (_req: Request, res: Response) => {
  res.sendFile(join(__dirname_local, "..", "public", "waitlist.html"));
});

app.get("/waitlist", (_req: Request, res: Response) => {
  res.redirect("/");
});

app.get("/upgrade", (_req: Request, res: Response) => {
  const filePath = join(__dirname_local, "..", "public", "upgrade.html");

  let html: string;
  try {
    html = readFileSync(filePath, "utf-8");
  } catch {
    res.status(404).send("Upgrade page not found");
    return;
  }

  // Inject Paddle config as meta tags
  const clientToken = process.env.PADDLE_CLIENT_TOKEN || "";
  const paddleEnv = process.env.PADDLE_ENVIRONMENT || "sandbox";
  const priceId = process.env.PADDLE_PRICE_ID || "";

  const metaTags = [
    `<meta name="paddle-client-token" content="${clientToken}">`,
    `<meta name="paddle-environment" content="${paddleEnv}">`,
    `<meta name="paddle-price-id" content="${priceId}">`,
  ].join("\n  ");

  html = html.replace("<head>", `<head>\n  ${metaTags}`);
  res.type("html").send(html);
});

app.get("/privacy", (_req: Request, res: Response) => {
  res.sendFile(join(__dirname_local, "..", "public", "privacy.html"));
});

// --- Static Files ---
app.use(express.static("public"));

// --- REST API: Auth check (for dashboard login — legacy, kept for backward compat) ---
app.post("/api/auth", express.json(), (req: Request, res: Response) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
});

// --- REST API: Magic Link Auth (no auth required) ---

// POST /api/auth/magic-link — Request a magic link email
app.post("/api/auth/magic-link", express.json(), async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({ error: "Valid email is required" });
      return;
    }

    const token = generateMagicToken(email);
    await sendMagicLink(email, token);

    res.json({ success: true, message: "Check your email for a sign-in link" });
  } catch (err) {
    console.error("[Auth] Magic link request failed:", err);
    res.status(500).json({
      error: "Failed to send magic link",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// GET /auth/verify — HTML page for magic link landing (user clicks link in email)
app.get("/auth/verify", (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) {
    res.send(verifyPageHtml(false, "Missing token. Please request a new sign-in link."));
    return;
  }

  const result = validateMagicToken(token);
  if (!result) {
    res.send(verifyPageHtml(false, "This link has expired or was already used. Please request a new one."));
    return;
  }

  // Find or create user
  let user = findUserByEmail(result.email);
  if (!user) {
    user = createUser(result.email);
    console.log(`[Auth] New user created via web: ${user.email} (${user.id})`);
  }

  const jwtToken = signJwt({ userId: user.id, email: user.email, plan: user.plan });
  console.log(`[Auth] JWT issued via web for ${user.email}`);

  // Store for extension polling
  const userInfo = { id: user.id, email: user.email, plan: user.plan };
  storePendingJwt(user.email, jwtToken, userInfo);

  res.send(verifyPageHtml(true, `Welcome, ${user.email}! You're signed in.`));
});

function verifyPageHtml(success: boolean, message: string): string {
  const icon = success
    ? `<div style="width:64px;height:64px;border-radius:50%;background:#22c55e20;display:flex;align-items:center;justify-content:center;margin:0 auto 16px"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg></div>`
    : `<div style="width:64px;height:64px;border-radius:50%;background:#f8717120;display:flex;align-items:center;justify-content:center;margin:0 auto 16px"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></div>`;

  const action = success
    ? `<p style="color:#666;font-size:14px;margin-top:16px">You can close this tab. The NeuralTrace extension will detect your sign-in automatically.</p>`
    : `<a href="/" style="display:inline-block;margin-top:16px;background:#6c63ff;color:white;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:500;font-size:14px">Request new link</a>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NeuralTrace — Sign In</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0a0a0f;color:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center;max-width:400px;padding:40px 20px">
  ${icon}
  <h1 style="font-size:24px;font-weight:700;color:#6c63ff;margin-bottom:8px">NeuralTrace</h1>
  <p style="font-size:16px;margin:16px 0;color:${success ? '#f5f5f5' : '#f87171'}">${message}</p>
  ${action}
</div>
</body></html>`;
}

// GET /api/auth/verify — Validate magic link token, issue JWT (JSON API)
app.get("/api/auth/verify", (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) {
    res.status(400).json({ error: "Missing token parameter" });
    return;
  }

  const result = validateMagicToken(token);
  if (!result) {
    res.status(401).json({ error: "Invalid, expired, or already-used token" });
    return;
  }

  // Find or create user
  let user = findUserByEmail(result.email);
  if (!user) {
    user = createUser(result.email);
    console.log(`[Auth] New user created: ${user.email} (${user.id})`);
  }

  const jwtToken = signJwt({ userId: user.id, email: user.email, plan: user.plan });
  console.log(`[Auth] JWT issued for ${user.email}`);

  // Store for extension polling
  const userInfo = { id: user.id, email: user.email, plan: user.plan };
  storePendingJwt(user.email, jwtToken, userInfo);

  res.json({ jwt: jwtToken, user: userInfo });
});

// GET /api/auth/status — Extension polls this for sign-in completion
// Stores pending JWTs in memory (simple, no DB table needed)
const pendingJwts: Map<string, { jwt: string; user: { id: string; email: string; plan: string }; expiresAt: number }> = new Map();

app.get("/api/auth/status", (req: Request, res: Response) => {
  const email = (req.query.email as string)?.toLowerCase();
  if (!email) {
    res.status(400).json({ error: "Missing email parameter" });
    return;
  }

  const pending = pendingJwts.get(email);
  if (pending && pending.expiresAt > Date.now()) {
    pendingJwts.delete(email); // One-time retrieval
    res.json({ authenticated: true, jwt: pending.jwt, user: pending.user });
    return;
  }

  res.json({ authenticated: false });
});

// Helper: store JWT for extension polling (called after magic link verify via web)
export function storePendingJwt(email: string, jwt: string, user: { id: string; email: string; plan: string }): void {
  pendingJwts.set(email.toLowerCase(), {
    jwt,
    user,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minute expiry
  });
}

// --- REST API: API Key Management (requires auth) ---
app.post("/api/keys", express.json(), authMiddleware, apiKeyLimitMiddleware, (req: Request, res: Response) => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const name = (req.body?.name as string) || "default";
  const { rawKey, row } = createApiKey(req.userId, name);
  console.log(`[Auth] API key created for user ${req.userId} (name: ${name})`);
  res.status(201).json({
    key: rawKey,
    name: row.name,
    created_at: row.created_at,
    message: "Save this key — it won't be shown again.",
  });
});

// --- REST API: AI Chat Proxy (SSE streaming) ---
app.post("/api/chat/completions", express.json({ limit: "1mb" }), authMiddleware, handleChatProxy);

// --- REST API: User Status ---
app.get("/api/user/status", authMiddleware, handleUserStatus);

// Admin panel — password-protected trace viewer
app.get("/admin", (req: Request, res: Response) => {
  if (!ADMIN_PASSWORD) {
    res.status(503).send("ADMIN_PASSWORD not configured.");
    return;
  }

  const auth = req.query.key as string;
  if (auth !== ADMIN_PASSWORD) {
    res.status(401).send(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>NeuralTrace Admin</title>
      <style>body{font-family:system-ui;background:#0a0a0f;color:#c9d1d9;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
      form{background:#161b22;padding:2rem;border-radius:8px;border:1px solid #30363d}
      input{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:0.5rem;border-radius:4px;margin-right:0.5rem}
      button{background:#238636;color:#fff;border:none;padding:0.5rem 1rem;border-radius:4px;cursor:pointer}
      button:hover{background:#2ea043}</style></head>
      <body><form method="GET"><label>Password: </label><input type="password" name="key" autofocus>
      <button type="submit">Enter</button></form></body></html>
    `);
    return;
  }

  const traces = getRecentTraces(10);
  const total = getTraceCount();

  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const rows = traces.map((t) => `
    <tr>
      <td>${t.id}</td>
      <td>${escapeHtml(t.content)}</td>
      <td>${t.tags ? escapeHtml(t.tags) : '<span class="dim">—</span>'}</td>
      <td>${t.created_at}</td>
    </tr>
  `).join("");

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>NeuralTrace Admin</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0f; color: #c9d1d9; padding: 2rem; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
        h1 { font-size: 1.5rem; color: #58a6ff; }
        .badge { background: #161b22; border: 1px solid #30363d; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; }
        table { width: 100%; border-collapse: collapse; background: #161b22; border-radius: 8px; overflow: hidden; }
        th { background: #1c2128; text-align: left; padding: 0.75rem 1rem; font-size: 0.8rem; text-transform: uppercase; color: #8b949e; border-bottom: 1px solid #30363d; }
        td { padding: 0.75rem 1rem; border-bottom: 1px solid #21262d; font-size: 0.9rem; vertical-align: top; }
        tr:last-child td { border-bottom: none; }
        tr:hover { background: #1c2128; }
        .dim { color: #484f58; }
        .empty { text-align: center; padding: 3rem; color: #484f58; }
        td:first-child { color: #484f58; width: 3rem; }
        td:nth-child(2) { max-width: 500px; word-wrap: break-word; }
        td:nth-child(3) { color: #d2a8ff; font-size: 0.85rem; }
        td:nth-child(4) { color: #8b949e; font-size: 0.85rem; white-space: nowrap; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>NeuralTrace Vault</h1>
        <span class="badge">${total} trace${total !== 1 ? "s" : ""} stored</span>
      </div>
      <table>
        <thead><tr><th>#</th><th>Content</th><th>Tags</th><th>Created</th></tr></thead>
        <tbody>
          ${rows || '<tr><td colspan="4" class="empty">No traces yet.</td></tr>'}
        </tbody>
      </table>
    </body>
    </html>
  `);
});

// --- Auth helper: checks cloud auth (via middleware) or selfhosted ADMIN_PASSWORD ---
function isAuthorized(req: Request): boolean {
  // Cloud mode: middleware already validated JWT/API key and set req.userId
  if (IS_CLOUD) return !!req.userId;
  // Self-hosted: check ADMIN_PASSWORD bearer token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  return authHeader.slice(7) === ADMIN_PASSWORD;
}

// Apply auth middleware to all /api/ routes (except auth endpoints handled above)
app.use("/api/trace", authMiddleware);
app.use("/api/traces", authMiddleware);
app.use("/api/search", authMiddleware);

// --- REST API: CLI Trace Capture ---
app.post("/api/trace", express.json(), traceLimitMiddleware, async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { content, tags } = req.body;
  if (!content || typeof content !== "string" || content.trim() === "") {
    res.status(400).json({ error: "Missing or empty 'content' field" });
    return;
  }

  const tagsStr = typeof tags === "string" ? tags : "";

  let vector: string | undefined;
  if (HAS_OPENAI_KEY) {
    try {
      const embedding = await getEmbedding(content);
      vector = JSON.stringify(embedding);
    } catch (err) {
      console.error("[API] Embedding failed:", err);
    }
  }

  const source = typeof req.body.source === "string" ? req.body.source : "extension";
  const userDb = resolveDb(req.userId);
  const id = insertTrace(content, tagsStr, vector, "raw", source, userDb);

  res.status(201).json({
    id,
    content,
    tags: tagsStr || null,
    embedding: !!vector,
  });
});

// --- REST API: Delete Trace ---
app.delete("/api/trace/:id", authMiddleware, (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid trace ID" });
    return;
  }

  const userDb = resolveDb(req.userId);
  const deleted = deleteTrace(id, userDb);
  if (deleted) {
    res.json({ deleted: true, id });
  } else {
    res.status(404).json({ error: "Trace not found" });
  }
});

// --- REST API: Update Trace Metadata ---
app.patch("/api/trace/:id", express.json(), authMiddleware, (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid trace ID" });
    return;
  }

  const { metadata } = req.body;
  if (!metadata || typeof metadata !== "object") {
    res.status(400).json({ error: "metadata (object) required" });
    return;
  }

  const userDb = resolveDb(req.userId);
  const updated = updateTraceMetadata(id, JSON.stringify(metadata), userDb);
  if (updated) {
    res.json({ updated: true, id });
  } else {
    res.status(404).json({ error: "Trace not found" });
  }
});

// --- REST API: Get Recent Traces ---
app.get("/api/traces", (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const userDb = resolveDb(req.userId);
  const traces = getRecentTraces(limit, userDb);
  const total = getTraceCount(userDb);

  res.json({ traces, total });
});

// --- REST API: Search Traces (hybrid scoring) ---
app.get("/api/search", searchLimitMiddleware, async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const query = (req.query.q as string) || "";
  if (!query.trim()) {
    res.json({ results: [], query: "" });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const tagsFilter = req.query.tags as string | undefined;
  const after = req.query.after as string | undefined;
  const before = req.query.before as string | undefined;

  const SEMANTIC_WEIGHT = 0.7;
  const KEYWORD_WEIGHT = 0.3;

  const userDb = resolveDb(req.userId);
  const candidates = (tagsFilter || after || before)
    ? searchTracesFiltered({ tags: tagsFilter, after, before, limit: 200 }, userDb)
    : getAllTraces(userDb);

  if (HAS_OPENAI_KEY) {
    try {
      const queryVector = await getEmbedding(query);

      const scored = candidates.map((t) => {
        const sem = t.vector ? cosineSimilarity(queryVector, JSON.parse(t.vector) as number[]) : 0;
        const kw = keywordScore(t.content, t.tags, query);
        const rec = recencyWeight(t.created_at);
        const finalScore = rec * (SEMANTIC_WEIGHT * sem + KEYWORD_WEIGHT * kw);
        return {
          id: t.id, content: t.content, tags: t.tags, created_at: t.created_at,
          metadata: (t as any).metadata ? JSON.parse((t as any).metadata) : null,
          score: Number(finalScore.toFixed(4)),
          match: (sem > 0 ? "hybrid" : kw > 0 ? "keyword" : "none") as string,
        };
      });

      const results = scored
        .filter((r) => r.score > 0.01)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      res.json({ results, query });
      return;
    } catch (err) {
      console.error("[API Search] Semantic search failed, falling back:", err);
    }
  }

  const results = candidates
    .map((t) => {
      const kw = keywordScore(t.content, t.tags, query);
      const rec = recencyWeight(t.created_at);
      return {
        id: t.id, content: t.content, tags: t.tags, created_at: t.created_at,
        metadata: (t as any).metadata ? JSON.parse((t as any).metadata) : null,
        score: Number((rec * KEYWORD_WEIGHT * kw).toFixed(4)),
        match: "keyword" as string,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  res.json({ results, query });
});

// --- SSE Transport (legacy: Claude Code, VS Code, Claude Desktop) ---
// --- MCP auth helper ---
function extractMcpUserId(req: Request): string | null {
  // Check ?key= query param first, then Authorization header
  const keyParam = req.query.key as string | undefined;
  const authHeader = req.headers.authorization;

  // API key auth (nt_*)
  let rawKey: string | undefined;
  if (keyParam?.startsWith("nt_")) {
    rawKey = keyParam;
  } else if (authHeader?.startsWith("Bearer nt_")) {
    rawKey = authHeader.slice(7);
  }

  if (rawKey) return validateApiKey(rawKey);

  // OAuth token auth (ntoauth_*)
  if (authHeader?.startsWith("Bearer ntoauth_")) {
    const oauthToken = authHeader.slice(7);
    const userId = validateOAuthToken(oauthToken);
    if (userId) {
      console.log(`[MCP] OAuth token authenticated user: ${userId}`);
      return userId;
    }
  }

  return null;
}

function getMcpDb(req: Request): import("better-sqlite3").Database | undefined {
  if (!IS_CLOUD) return undefined; // selfhosted uses global DB
  const userId = extractMcpUserId(req);
  if (!userId) return undefined;
  return resolveDb(userId);
}

app.get("/sse", async (req: Request, res: Response) => {
  console.log("[SSE] New client connection");

  let mcpUserId: string | null = null;
  if (IS_CLOUD) {
    mcpUserId = extractMcpUserId(req);
    if (!mcpUserId) {
      res.status(401).json({ error: "API key required. Use ?key=nt_xxx or Authorization: Bearer nt_xxx" });
      return;
    }
    console.log(`[SSE] Authenticated user: ${mcpUserId}`);
  }

  const db = getMcpDb(req);
  const mcpServer = createMcpServer(db, mcpUserId || undefined);
  const transport = new SSEServerTransport("/messages", res);
  sseTransports[transport.sessionId] = transport;

  res.on("close", () => {
    console.log(`[SSE] Client disconnected: ${transport.sessionId}`);
    delete sseTransports[transport.sessionId];
    mcpServer.close().catch(() => {});
  });

  try {
    await mcpServer.connect(transport);
    console.log(`[SSE] Client connected: ${transport.sessionId}`);
  } catch (err) {
    console.error("[SSE] Connection failed:", err);
    if (!res.headersSent) {
      res.status(503).json({ error: "SSE connection failed" });
    }
  }
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = sseTransports[sessionId];

  if (!transport) {
    res.status(400).json({ error: "No active session for this sessionId" });
    return;
  }

  await transport.handlePostMessage(req, res);
});

// --- Streamable HTTP Transport (modern: Google Antigravity, OpenAI Codex) ---
app.post("/mcp", express.json(), async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Existing session — route to its transport
  if (sessionId && httpTransports[sessionId]) {
    const { transport } = httpTransports[sessionId];
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — authenticate and create server + transport
  let mcpUserId: string | null = null;
  if (IS_CLOUD) {
    mcpUserId = extractMcpUserId(req);
    if (!mcpUserId) {
      res.status(401).json({ error: "API key required. Use ?key=nt_xxx or Authorization: Bearer nt_xxx" });
      return;
    }
    console.log(`[HTTP] Authenticated user: ${mcpUserId}`);
  }

  const db = getMcpDb(req);
  const mcpServer = createMcpServer(db, mcpUserId || undefined);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      console.log(`[HTTP] Session closed: ${sid}`);
      delete httpTransports[sid];
    }
  };

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);

  // Session ID is set after handleRequest processes the initialize
  const sid = transport.sessionId;
  if (sid) {
    httpTransports[sid] = { transport, server: mcpServer };
    console.log(`[HTTP] New session: ${sid}`);
  }
});

app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && httpTransports[sessionId]) {
    const { transport } = httpTransports[sessionId];
    await transport.handleRequest(req, res);
    return;
  }
  res.status(400).json({ error: "No active session. Send an initialize request via POST first." });
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && httpTransports[sessionId]) {
    const { transport, server: mcpServer } = httpTransports[sessionId];
    await transport.handleRequest(req, res);
    await mcpServer.close();
    delete httpTransports[sessionId];
    return;
  }
  res.status(400).json({ error: "No active session." });
});

// --- Start ---
getDb();
console.log("[DB] SQLite database initialized at data/neuraltrace.db");

// Always init system DB — auth needs magic_tokens table in both modes
initSystemDb();

console.log(`[Config] Mode: ${IS_CLOUD ? "cloud" : "selfhosted"}`);
console.log(`[Config] Semantic search: ${HAS_OPENAI_KEY ? "ENABLED" : "DISABLED (set OPENAI_API_KEY)"}`);

app.listen(PORT, () => {
  console.log(`[NeuralTrace] MCP server running on http://localhost:${PORT}`);
  console.log(`[NeuralTrace] SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`[NeuralTrace] Streamable HTTP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`[NeuralTrace] Messages endpoint: POST http://localhost:${PORT}/messages`);

  // --- Consolidation loop ---
  const consolidationEnabled = process.env.CONSOLIDATION_ENABLED !== "false";
  if (consolidationEnabled) {
    const intervalMs = Number(process.env.CONSOLIDATION_INTERVAL_MS) || 1800000; // 30 min default
    const dryRun = process.env.CONSOLIDATION_DRY_RUN === "true";
    startConsolidationLoop(intervalMs, dryRun);
  } else {
    console.log("[Consolidator] Disabled via CONSOLIDATION_ENABLED=false");
  }
});
