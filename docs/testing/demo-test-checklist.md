# NeuralTrace Demo Test Checklist

**Purpose:** Walk through the full user experience — both Claude Code (VS Code extension) and Google Antigravity — to validate the SXSW demo flow end-to-end.

---

## Prerequisites

- [ ] VS Code open with Claude Code extension installed and active
- [ ] Google Antigravity open with `neuraltrace-ai` project folder loaded
- [ ] Antigravity MCP config points to `https://neuraltrace.ai/mcp`
- [ ] Browser tab open to `https://neuraltrace.ai` (landing page)
- [ ] Browser tab open to `https://neuraltrace.ai/dashboard` (vault UI)
- [ ] Claude.ai account (Pro or Max plan) logged in
- [ ] ChatGPT account (Plus or higher) logged in

---

## Part 1: Claude Code (VS Code Extension — SSE Transport)

### 1.1 Connect
- [ ] Open Claude Code panel in VS Code
- [ ] Verify NeuralTrace MCP is connected (check `/mcp` or look for `neuraltrace` in available tools)
- [ ] Confirm all 3 tools are listed: `add_trace`, `search_neuraltrace_memory`, `delete_trace`

### 1.2 Search existing traces
- [ ] Ask Claude: *"Search my NeuralTrace vault for database preferences"*
- [ ] Confirm it calls `search_neuraltrace_memory` and returns results (should find the SQLite/WAL mode trace)
- [ ] Verify results include similarity scores (semantic search working)

### 1.3 Save a new trace
- [ ] Ask Claude: *"Save a trace: For SXSW 2026 projects, use Vercel for static marketing sites but keep production SaaS on our VPS. Tags: deployment, sxsw, architecture"*
- [ ] Confirm it calls `add_trace` and returns a success message with an ID
- [ ] Note the trace ID: ____

### 1.4 Verify in dashboard
- [ ] Switch to browser → `https://neuraltrace.ai/dashboard`
- [ ] Log in (if needed)
- [ ] Confirm the new trace appears in the vault
- [ ] Search "SXSW" in the dashboard — confirm it shows up

### 1.5 Recall the trace you just saved
- [ ] Back in Claude Code, ask: *"Where should I deploy my new marketing site?"*
- [ ] Confirm Claude calls `search_neuraltrace_memory` automatically (or prompt it)
- [ ] Verify it finds the SXSW deployment trace and uses it in its answer

---

## Part 2: Google Antigravity (Streamable HTTP Transport)

### 2.1 Connect
- [ ] Open the Antigravity Agent panel
- [ ] Go to Manage MCPs — confirm `neuraltrace` shows **3/3 tools**, status **Enabled**

### 2.2 Cross-vendor recall (the magic moment)
- [ ] Ask Antigravity: *"Where should I deploy my new marketing site?"*
- [ ] Confirm it calls `search_neuraltrace_memory`
- [ ] Verify it finds the **same SXSW trace** saved from Claude Code
- [ ] Confirm the answer references Vercel for marketing sites / VPS for production

### 2.3 Save a trace from Antigravity
- [ ] Ask Antigravity: *"Save a trace: Always use TypeScript strict mode for NeuralTrace development. Tags: typescript, conventions, neuraltrace"*
- [ ] Confirm it calls `add_trace` and returns success
- [ ] Note the trace ID: ____

### 2.4 Verify cross-vendor round-trip
- [ ] Switch back to Claude Code in VS Code
- [ ] Ask Claude: *"Search my vault for TypeScript conventions"*
- [ ] Confirm it finds the trace saved from Antigravity
- [ ] **This proves the round-trip: Claude -> Vault -> Antigravity -> Vault -> Claude**

---

## Part 3: Dashboard Verification

- [ ] Open `https://neuraltrace.ai/dashboard`
- [ ] Confirm both new traces appear (SXSW deployment + TypeScript conventions)
- [ ] Use the search feature — search "deploy" and verify semantic results
- [ ] Confirm trace count increased from 19

---

## Part 4: Cleanup (Parts 1-2)

- [ ] Delete test traces from Parts 1-2 (via Claude Code, Antigravity, or dashboard)
- [ ] Verify trace count returns to baseline

---

## Part 5: Web Client Testing (Claude.ai + ChatGPT)

### 5.1 Claude.ai (Custom Connector — Streamable HTTP)
- [ ] Open Claude.ai (Pro or Max plan required)
- [ ] Go to Settings > Connectors > Add custom connector
- [ ] Name: `NeuralTrace` | URL: `https://neuraltrace.ai/mcp` | OAuth: leave blank
- [ ] Click Add — confirm connector appears in list
- [ ] Start a new chat, ask: *"Search my NeuralTrace vault for database preferences"*
- [ ] Confirm it calls `search_neuraltrace_memory` and returns results
- [ ] Ask: *"Save a trace: Always use dark mode for demo presentations. Tags: preferences, demo, ui"*
- [ ] Confirm it calls `add_trace` and returns success
- [ ] Note the trace ID: ____

### 5.2 ChatGPT (Custom App — Streamable HTTP)
- [ ] Open ChatGPT (Plus or higher required)
- [ ] Enable Developer Mode: Settings > Apps & Connectors > Advanced > Developer Mode ON
- [ ] Create new App: Name: `NeuralTrace` | MCP Server URL: `https://neuraltrace.ai/mcp` | Auth: No authentication
- [ ] Check "I understand and want to continue" > Click Create
- [ ] Start a new chat, ask: *"Search my NeuralTrace vault for database preferences"*
- [ ] Confirm it calls `search_neuraltrace_memory` and returns results
- [ ] Ask: *"Save a trace: ChatGPT can also access my memory vault. Tags: chatgpt, mcp, cross-vendor"*
- [ ] Confirm it calls `add_trace` and returns success
- [ ] Note the trace ID: ____

### 5.3 Cross-vendor round-trip (5 clients)
- [ ] In Claude Code (VS Code): *"Search my vault for demo presentations"*
- [ ] Confirm it finds the trace saved from Claude.ai
- [ ] In Antigravity: *"Search my vault for ChatGPT"*
- [ ] Confirm it finds the trace saved from ChatGPT
- [ ] **This proves: Claude Code + Claude.ai + ChatGPT + Antigravity all share one vault**

---

## Part 6: OpenAI Codex (Streamable HTTP)

### 6.1 Connect
- [ ] Open OpenAI Codex desktop app
- [ ] Go to Settings > MCP servers > Connect to a custom MCP
- [ ] Select **Streamable HTTP** tab
- [ ] Name: `NeuralTrace` | URL: `https://neuraltrace.ai/mcp`
- [ ] Click Save — confirm it connects and tools are detected

### 6.2 Search
- [ ] Ask Codex: *"Search my NeuralTrace vault for database preferences"*
- [ ] Confirm it calls `search_neuraltrace_memory` and returns results

### 6.3 Save
- [ ] Ask Codex: *"Save a trace: OpenAI Codex can access NeuralTrace memory vault. Tags: codex, mcp, cross-vendor"*
- [ ] Confirm it calls `add_trace` and returns success
- [ ] Note the trace ID: ____

### 6.4 Cross-vendor verification
- [ ] In Claude Code: *"Search my vault for Codex"*
- [ ] Confirm it finds the trace saved from Codex

---

## Part 7: Cleanup

- [ ] Delete all test traces from Parts 5-6 (via Claude Code, Antigravity, or dashboard)
- [ ] Verify trace count returns to baseline

---

## Part 8: CLI Bonus (Optional)

- [ ] Open a terminal (not in VS Code)
- [ ] Run: `NEURALTRACE_KEY="your-admin-password" trace "CLI test trace" --tags "cli,test"`
- [ ] Confirm success message
- [ ] Verify it appears in the dashboard
- [ ] Delete it after

---

## Results

| Test | Pass/Fail | Notes |
|------|-----------|-------|
| Claude Code connects (SSE) | PASS | 3/3 tools confirmed (add_trace, search_neuraltrace_memory, delete_trace) |
| Search returns semantic results | PASS | "database preferences" returned trace [8] SQLite/WAL at score 0.368 |
| Save trace from Claude Code | PASS | Trace [26] saved — SXSW deployment preferences (Vercel vs VPS) |
| Trace appears in dashboard | PASS | Trace [26] confirmed in dashboard, searchable by "SXSW" |
| Antigravity connects (Streamable HTTP) | PASS | 3/3 tools, status Enabled |
| Cross-vendor recall works | PASS | Antigravity recalled trace [26] saved from Claude Code — answered "Vercel for marketing sites" |
| Save trace from Antigravity | PASS | Trace [27] saved — TypeScript strict mode convention |
| Round-trip verified (both directions) | PASS | Claude Code found trace [27] (score 0.338) saved from Antigravity |
| Dashboard shows all traces | PASS | Both test traces visible in dashboard |
| Cleanup successful | PASS | Delete worked from: existing Claude Code session, Antigravity, and new Claude Code session |
| Claude.ai connects (Streamable HTTP) | PASS | 3/3 tools detected as custom connector, no OAuth needed |
| Claude.ai search works | PASS | Found trace [8] SQLite/WAL — same result as all other clients |
| Claude.ai save trace works | PASS | Trace [28] saved — "Always use dark mode for demo presentations" |
| ChatGPT connects (Streamable HTTP) | PASS | 3/3 tools detected, Developer Mode required, auth: None |
| ChatGPT search works | PASS | Found trace [8] SQLite/WAL — ChatGPT gave deepest interpretation of all clients |
| ChatGPT save trace works | PASS | Trace [29] saved — "ChatGPT can also access my memory vault" |
| 5-client cross-vendor round-trip | PASS | Claude Code found [28] from Claude.ai (score 0.823); Antigravity found [29] from ChatGPT |
| OpenAI Codex connects (Streamable HTTP) | PASS | Connected via Streamable HTTP, tools auto-detected |
| Codex search works | PASS | Found trace [8] SQLite/WAL — ran search twice (agentic refinement) |
| Codex save trace works | PASS | Trace saved, confirmed in dashboard |
| Codex cross-vendor verification | PASS | Trace accessible from other clients |

**Known issue discovered:** Auto-recall only works when neuraltrace-ai CLAUDE.md context is loaded. New Claude Code sessions with MCP connected but no @neuraltrace-ai reference give generic answers. Antigravity always recalls. See `docs/memory-modes-strategy.md` > "Known Gap: Auto-Recall is Context-Dependent" for full analysis.

**ChatGPT note:** Developer Mode must be ON (Settings > Apps & Connectors > Advanced). This disables ChatGPT's built-in Memory feature while active. Custom MCP servers show as "DEV" apps regardless of plan tier (Plus/Business/Pro).

**Date tested:** 2026-03-06 (Parts 1-4), 2026-03-07 (Parts 5-6)
**Tester:** Abel Alvarado
**Overall result:** PASS (21/21)

**Note:** Delete trace works even in new Claude Code sessions without @neuraltrace-ai context — the auto-recall known issue does not affect tool execution, only unprompted memory recall.
