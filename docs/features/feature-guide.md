# NeuralTrace Feature Guide

**What this is:** A complete reference of every NeuralTrace feature — what it does, how it works, how to use it, and whether it's been tested.

**Last updated:** 2026-03-22 (38 features)

---

## Core Features (Original — v1.0)

These are the foundational features that shipped first. All 21 tests passing across 6 clients.

---

### 1. Add Trace (`add_trace`)

**What it does:** Saves a memory, preference, or decision to your vault so any AI tool can recall it later.

**How it works:** When you save a trace, NeuralTrace:
1. Stores the text content and tags in SQLite
2. Sends the content to OpenAI's embedding API (`text-embedding-3-small`) to generate a 1536-dimension vector
3. Stores that vector alongside the content for future semantic search

**How to use it:**
- In any connected AI tool, say: *"Save a trace: I prefer dark mode for all dashboards. Tags: preferences, ui"*
- The AI calls `add_trace` with `content` and `tags`
- You get back a confirmation with the trace ID

**Inputs:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `content` | Yes | The memory or preference to save |
| `tags` | No | Comma-separated keywords for filtering |

**Test status:** PASS (tested across Claude Code, Antigravity, Claude.ai, ChatGPT, OpenAI Codex, Dashboard)

---

### 2. Search Memory (`search_neuraltrace_memory`)

**What it does:** Searches your vault using semantic understanding — not just keyword matching. Ask a question in natural language and it finds relevant memories even if the exact words don't match.

**How it works:**
1. Your query gets converted to a vector (same embedding model)
2. That vector is compared against every trace's vector using cosine similarity
3. Results are ranked by a hybrid score (semantic + keyword + recency) and returned

**How to use it:**
- Ask any connected AI: *"Search my vault for deployment preferences"*
- It calls `search_neuraltrace_memory` and returns ranked results with scores

**Inputs:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | What you're looking for (natural language) |
| `tags` | No | Filter by specific tags (see Feature #6 below) |
| `after` | No | Only traces after this date (see Feature #6 below) |
| `before` | No | Only traces before this date (see Feature #6 below) |

**Test status:** PASS (tested across all 6 clients)

---

### 3. Delete Trace (`delete_trace`)

**What it does:** Permanently removes a trace from your vault by its ID.

**How it works:** Deletes the row from SQLite. The vector, content, and tags are all removed.

**How to use it:**
- Say: *"Delete trace 15"*
- The AI calls `delete_trace` with `id: 15`

**Inputs:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | Yes | The numeric ID of the trace to delete |

**Test status:** PASS (tested across multiple clients)

---

### 4. Cross-Vendor Memory Sharing

**What it does:** Any trace saved from one AI tool is instantly available in every other connected tool. Save in Claude Code, recall in ChatGPT. Save in Antigravity, recall in Claude.ai.

**How it works:** All clients connect to the same NeuralTrace server and the same SQLite database. There's no sync or replication — it's one vault, many doors.

**Transports supported:**
| Transport | Endpoint | Clients |
|-----------|----------|---------|
| SSE (legacy) | `/sse` + `/messages` | Claude Code, VS Code, Claude Desktop |
| Streamable HTTP (modern) | `/mcp` | Antigravity, OpenAI Codex, Claude.ai, ChatGPT |

**How to use it:** Just connect multiple AI tools to NeuralTrace. No configuration beyond adding the MCP endpoint.

**Test status:** PASS — verified round-trip across Claude Code, Antigravity, Claude.ai, ChatGPT, and OpenAI Codex

---

### 5. Web Dashboard (`neuraltrace.ai/dashboard`)

**What it does:** A browser-based UI to view, search, and manage your traces. No AI tool needed — just log in and browse your vault.

**Pages:**
| Page | What it shows |
|------|---------------|
| Dashboard | Total traces, recent traces, tags at a glance |
| Search | Search your vault with the same hybrid scoring as the MCP tool |
| Settings | Vault stats, connection info, bulk trace management |

**How to use it:** Go to `https://neuraltrace.ai/dashboard` and log in with your admin password.

**Test status:** PASS

---

### 6. REST API + CLI

**What it does:** A REST API for programmatic access and a CLI command (`trace`) for saving memories from the terminal.

**Endpoints:**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth` | Login (returns auth confirmation) |
| GET | `/api/traces` | List recent traces |
| GET | `/api/search?q=...` | Search traces |
| POST | `/api/trace` | Save a new trace |
| DELETE | `/api/trace/:id` | Delete a trace |

**All API calls require:** `Authorization: Bearer <ADMIN_PASSWORD>` header

**CLI example:**
```bash
NEURALTRACE_KEY="your-password" trace "Always use WAL mode for SQLite" --tags "database,sqlite"
```

**Test status:** PASS

---

## Enhanced Features (v1.1 — Built 2026-03-06)

These features improve search quality and add intelligence. They work behind the scenes to make everything above work *better*.

---

### 7. Hybrid Search Scoring

**What it does:** Instead of relying on just one method to find relevant traces, search now combines three signals into a single score. This means better, more accurate results.

**The three signals:**

| Signal | Weight | What it measures |
|--------|--------|-----------------|
| Semantic similarity | 70% | How close the *meaning* of your query is to a trace (via vector math) |
| Keyword match | 30% | How many of your query words appear literally in the trace content or tags |
| Recency | multiplier | Newer traces get a slight boost — a preference set yesterday matters more than one from 6 months ago |

**How the score is calculated:**
```
finalScore = recencyWeight * (0.7 * semanticScore + 0.3 * keywordScore)
```

**Why it matters:** Pure semantic search can miss exact keyword matches. Pure keyword search misses synonyms and context. Hybrid gives you the best of both — and recency ensures your latest decisions take priority.

**How to use it:** You don't do anything different. Every search (MCP tool, dashboard, API) automatically uses hybrid scoring. You just get better results.

**Test status:** PASS (2026-03-07) — "database preferences" returned trace [8] at 0.399 (hybrid). "SQLite WAL" boosted same trace to 0.674 (keyword component kicked in). All results show `match:hybrid`.

**Where it lives:** [src/index.ts](../src/index.ts) (lines 61-134), [src/embeddings.ts](../src/embeddings.ts) (keywordScore + recencyWeight functions)

---

### 8. Metadata Filtering

**What it does:** Lets you narrow search results by tags and/or date range *before* scoring. Instead of searching everything and hoping, you can say "only show me traces tagged 'deployment' from last week."

**Filter options:**

| Filter | Format | Example |
|--------|--------|---------|
| `tags` | Comma-separated | `"deployment,architecture"` — matches traces with *any* of these tags |
| `after` | ISO 8601 date | `"2026-03-01"` — only traces created on or after this date |
| `before` | ISO 8601 date | `"2026-03-07"` — only traces created on or before this date |

**How to use it:**
- Via MCP: *"Search my vault for database preferences, but only traces tagged 'sqlite'"*
- The AI passes `tags: "sqlite"` to `search_neuraltrace_memory`
- Via API: `GET /api/search?q=database&tags=sqlite&after=2026-03-01`

**How it works:** Filters are applied at the SQL level first (fast), then the remaining candidates go through hybrid scoring. This means fewer traces to score = faster results + more precise.

**Test status:** PASS (2026-03-07) — Search "preferences" with `tags=typescript` returned only trace [2] (has typescript tag). Search "NeuralTrace" with `after=2026-03-07` returned only March 7th traces. Both tag and date filters working.

**Where it lives:** [src/database.ts](../src/database.ts) (`searchTracesFiltered` function, lines 105-154)

---

### 9. Recency Weighting

**What it does:** Automatically gives newer traces a slight ranking boost over older ones with similar content. Your most recent decisions float to the top.

**How it works:** Uses a decay function:
```
recencyWeight = 1 / (1 + ageDays * 0.005)
```

| Trace age | Recency multiplier |
|-----------|-------------------|
| Today | 1.000 (full weight) |
| 1 week old | 0.966 |
| 1 month old | 0.870 |
| 6 months old | 0.526 |
| 1 year old | 0.354 |

**Why it matters:** If you saved "use PostgreSQL" 8 months ago but saved "use SQLite for prototypes" last week, a search for "database preference" will rank the SQLite trace higher — because it's your more recent decision.

**How to use it:** Automatic. Applied to every search result as a multiplier on the hybrid score.

**Test status:** PASS (2026-03-07) — Decay function verified: today=1.000, 1 week=0.966, 1 month=0.870, 6 months=0.526. Live search confirmed: trace [30] (March 7) scored 0.695 vs trace [5] (March 3) at 0.411 for same query — recency boosted newer trace.

**Where it lives:** [src/embeddings.ts](../src/embeddings.ts) (`recencyWeight` function, lines 47-52)

---

### 10. MCP Auto-Recall Instructions

**What it does:** Tells AI clients to automatically search your vault before answering questions about preferences, conventions, or past decisions — without you having to ask.

**The instructions sent to every MCP client:**
> CRITICAL: The NeuralTrace vault is the user's PRIMARY memory. When they say "saved", "remembered", "bookmarked", "noted", "stored", or ask "where was", "what was", "do I have", "did I save", "I forgot", "what do I know about" — ALWAYS search the vault FIRST before checking your own memory or chat history.
>
> 1. Search the vault FIRST for ANY question about something the user might have previously encountered, saved, or decided.
> 2. When the user makes a decision worth remembering, offer to save it.
> 3. Use suggest_traces at the end of substantial conversations.
> 4. When searching, extract relevant keywords — try multiple variations if the first search returns no results.

**How it works:** These instructions are embedded in the MCP server configuration (`instructions` field). When an AI client connects, it receives these rules as part of the protocol handshake.

**Known limitation:** Auto-recall works best when the AI client's context includes NeuralTrace awareness (e.g., via CLAUDE.md or project context). In a fresh Claude Code session without `@neuraltrace-ai`, the AI may not proactively search — but it still *can* if you ask. Antigravity and ChatGPT always recall because they load MCP instructions by default.

**How to use it:** Just ask a question about a past decision. If auto-recall is working, the AI searches your vault before answering — you'll see it call `search_neuraltrace_memory` without being asked.

**Test status:** PASS (2026-03-08) — Rewrote instructions with broader trigger keywords. Stress-tested on Claude.ai: casual query "Do I have anything saved about snack prompt?" now triggers vault search (previously failed, Claude searched its own chat history instead). Deployed to production.

**Where it lives:** [src/index.ts](../src/index.ts) (`AUTO_RECALL_INSTRUCTIONS` constant, lines 290-298)

---

### 11. Suggest Traces (`suggest_traces`)

**What it does:** At the end of a conversation, analyzes what was discussed and proposes memories worth saving. You approve which ones to keep — nothing is saved without your permission.

**How it works:**
1. The AI passes a conversation summary to `suggest_traces`
2. NeuralTrace sends that summary to GPT-4o-mini with a prompt to extract key decisions, preferences, and reusable facts
3. Returns 1-5 proposed traces with suggested content and tags
4. You pick which ones to save, and the AI calls `add_trace` for each

**How to use it:**
- At the end of a productive session, say: *"Suggest traces from this conversation"*
- Or the AI may do this automatically (see auto-recall instructions above)

**Inputs:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `conversation_summary` | Yes | Summary of the conversation (the AI generates this) |

**Example output:**
```
I found 3 memory suggestions:

1. "Always use WAL mode for SQLite in production" (tags: database, sqlite, production)
2. "Prefer Traefik over Nginx for auto-SSL on VPS" (tags: deployment, infrastructure)
3. "Use CSS Modules instead of global CSS in Next.js projects" (tags: frontend, nextjs, conventions)

Which ones should I save?
```

**Test status:** PASS (manually tested by Abel 2026-03-06)

**Where it lives:** [src/index.ts](../src/index.ts) (lines 166-227), [src/embeddings.ts](../src/embeddings.ts) (`extractSuggestedTraces` function, lines 66-102)

---

## Chrome Extension Features (v2.0 — Built 2026-03-08)

The primary product surface. A memory-first AI chat in the browser side panel.

---

### 12. Side Panel Chat

**What it does:** A persistent AI chat powered by your vault, available on any webpage via the browser side panel. Opens with `Alt+Shift+N` or by clicking the toolbar icon.

**How it works:** Messages are sent to Qwen 3.5 Flash via OpenRouter with tool definitions. The LLM decides when to search/save/list from the vault or read the current page. Responses stream in real-time.

**Tech:** OpenRouter API, Manifest V3 `chrome.sidePanel`, SSE streaming with tool call parsing.

**Test status:** PASS (2026-03-08)

**Where it lives:** `extension/sidepanel.js`, `extension/sidepanel.html`, `extension/sidepanel.css`

---

### 13. Extension Vault Search

**What it does:** Search your vault from the side panel chat. Ask "What do I know about Docker?" and it searches semantically via the REST API.

**Test status:** PASS (2026-03-08)

---

### 14. Extension Save + Dedup

**What it does:** Save traces from the side panel chat. Say "Remember that I prefer dark mode" and it saves to the vault with auto-generated tags. Includes deduplication to prevent the LLM from creating duplicate entries.

**Test status:** PASS (2026-03-08)

---

### 15. Page Context Awareness

**What it does:** The extension can read the current tab's title, URL, and text content. Ask "What do I know about this page?" and it reads the page, searches the vault for related memories, and synthesizes both.

**How it works:** Side panel → background service worker → content script message (`extract-page`) → 3-strategy extraction (JSON-LD → Readability.js → CSS selector fallback) → returns up to 4,000 chars to LLM as tool result. Unsupported pages (chrome://, about:, edge://) return a clear error instead of empty text.

**Test status:** PASS (2026-03-22) — Tested on Guardian article. Readability.js extracts clean article text. Unsupported pages handled gracefully.

**Where it lives:** `extension/content.js` (extraction), `extension/background.js` (message handler), `extension/sidepanel.js` (`get_page_context` tool)

---

### 16. List Traces (Vault Overview)

**What it does:** Lists all traces from the vault for summaries and overviews. Used when the user asks "What's in my vault?" or "Summarize my memories."

**Why it exists:** The search tool requires keywords — broad queries like "summarize" return poor results. This tool fetches all traces via `/api/traces` so the LLM can synthesize an overview.

**Test status:** PASS (2026-03-08)

**Where it lives:** `extension/sidepanel.js` (`list_traces` tool)

---

### 17. Chat Persistence

**What it does:** Conversations survive panel close and browser restart. Reopen the side panel and your last conversation is exactly where you left it.

**How it works:** After every user message and assistant response, the full chat history is written to `chrome.storage.local`. On panel open, `init()` checks for an active conversation ID and restores it. Capped at 50 conversations (oldest auto-removed).

**Storage format:**
```javascript
{
  conversations: [{ id, title, messages[], createdAt, updatedAt }],
  activeConversationId: "lxyz123abc"
}
```

**Test status:** PASS (2026-03-08) — Send message, close panel, reopen → conversation restored. Browser restart → conversation restored. 50-conversation cap verified.

**Where it lives:** `extension/sidepanel.js` (`saveConversation`, `loadConversation`, `loadConversations`, `startNewConversation` functions)

---

### 18. Chat History UI

**What it does:** A full-screen overlay listing all past conversations. Click any conversation to load it. Hover to reveal a delete button. Includes a "New Conversation" button at the bottom.

**How to use it:** Click the clock icon in the header (left of the + icon). Browse past conversations by title (first user message) and relative timestamp ("5m ago", "about 2 hours ago", "3 days ago").

**UI details:**
- Active conversation highlighted with coral glow border
- Delete button appears on hover (X icon, turns red)
- Empty state message when no conversations exist
- "New Conversation" button with dashed border at bottom

**Test status:** PASS (2026-03-08) — History loads, conversations clickable, delete works, new conversation from overlay works, active conversation highlighted.

**Where it lives:** `extension/sidepanel.js` (`renderHistoryOverlay`), `extension/sidepanel.html` (overlay markup), `extension/sidepanel.css` (overlay styles)

---

### 19. Voice-to-Text Input

**What it does:** Speak into your microphone and your words appear in the chat input. No typing needed — just talk to your vault.

**How it works:** Uses the Web Speech API (`webkitSpeechRecognition`) with `continuous: true` for unlimited recording length. Chrome sends audio to Google's speech servers for real-time transcription. Interim results appear as you speak; final transcription replaces them when a phrase is confirmed.

**Two input modes:**
| Mode | How | When it stops |
|------|-----|---------------|
| **Click to toggle** | Click mic button once to start, click again to stop | When you click again or press `Cmd+Shift+M` |
| **Press and hold** | Hold mic button for 300ms+ | When you release the button |

**Keyboard shortcut:** `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Windows) — toggles recording on/off.

**First-time setup:** Chrome extension side panels can't show microphone permission prompts directly. On first use, a background tab opens automatically where Chrome asks for mic permission. Click Allow once — it's remembered permanently.

**Visual feedback:**
- Recording: mic button turns solid coral with a pulsing glow animation
- Status bar shows "Listening..." while recording
- Status bar shows "Voice captured — review and send" when done

**Test status:** PASS (2026-03-08) — Click-to-toggle works, press-and-hold works, keyboard shortcut works, permission flow works, transcription accurate.

**Where it lives:** `extension/sidepanel.js` (`startVoice`, `stopVoice`, `requestMicPermission`), `extension/mic-permission.html` + `mic-permission.js` (one-time permission page)

---

### 20. Context Menu — Remember This (Text Selection)

**What it does:** Right-click any highlighted text on a webpage and save it directly to your vault. No need to open the side panel or type anything.

**How it works:** When you select text and right-click → "Remember this with NeuralTrace", the background service worker grabs the selected text, the page title, and the URL, then saves it to the vault via the REST API. The side panel is notified so it can reflect the save.

**Saved format:**
```
[Selected text]

Source: [Page Title] ([URL])
```

**Tag:** `web-capture`

**Test status:** PASS (2026-03-09) — Tested on TechCrunch article. Trace stored with correct text, source attribution, and tag. Verified retrieval from both extension and Claude.ai (MCP).

**Where it lives:** `extension/background.js` (context menu listener, `nt-save-selection` handler)

---

### 21. Context Menu — Remember This Page

**What it does:** Right-click anywhere on a page and save a smart summary of the entire page to your vault. One click to bookmark a page with AI-generated understanding — not just a URL.

**How it works:**
1. Extracts page content using 3-strategy pipeline (JSON-LD → Readability.js → CSS selector fallback), up to 3,000 chars
2. Pulls page metadata (`og:description`, `og:image`)
3. Sends extracted content to Qwen 3.5 Flash (via OpenRouter or server proxy) for a 2-3 sentence summary (max_tokens: 600)
4. Saves the summary + title + URL + image to the vault
5. Falls back to raw content if AI summarization fails (no API key or error)

**Saved format:**
```
Page: [Title]
URL: [URL]
Image: [og:image URL]

Summary: [AI-generated 2-3 sentence summary]
```

**Tag:** `page-capture`

**Why AI summary matters:** Without it, `document.body.innerText` captures nav menus, cookie banners, and footer links — not article content. The smart targeting + AI summary ensures the vault stores actually useful information that any AI can reason against later.

**Test status:** PASS (2026-03-09) — Tested on TechCrunch article. Old behavior stored nav junk ("Skip to content, TechCrunch Desktop Logo, Latest, Startups..."). New behavior stores: "This page serves as a live announcement for TechCrunch All Stage in Boston... detailing an agenda of startup scaling talks and networking at the SoWa Power Station." Verified retrieval returns structured details (location, focus, agenda, source).

**Where it lives:** `extension/background.js` (`extractPageContent` function, `summarizePage` function, `nt-save-page` handler)

---

### 22. Smart Page Content Extraction

**What it does:** All page content extraction in the extension uses a 3-strategy pipeline to get the cleanest possible text from any page.

**How it works:** Three strategies, tried in order:
1. **JSON-LD** — Checks `script[type="application/ld+json"]` for `articleBody` (cleanest when available — no ads, nav, or sidebars)
2. **Readability.js** — Mozilla's battle-tested article extractor. Uses `isProbablyReaderable()` guard before parsing. Strips ads, nav, sidebars.
3. **CSS selector cascade** — `article` → `main` → `[role="main"]` → `body` (original fallback)

**Tiered content limits** (per consumer):
| Consumer | Limit | Rationale |
|----------|-------|-----------|
| Summarize Page | 10,000 chars | Quality matters, one-shot call |
| Get Page Context | 4,000 chars | Stays in chat history, compounds |
| Context Menu Save | 3,000 chars | Moderate, feeds AI summary |
| Quick Save | 3,000 chars | Cost-sensitive, no LLM |
| Enrichment | 2,000 chars | Sufficient for metadata extraction |

**Graceful failure:** Unsupported pages (chrome://, chrome-extension://, about:, edge://) show a clear "not supported" message instead of empty/confusing results.

**Test status:** PASS (2026-03-22) — Tested on Guardian article (Readability extraction), chrome://settings (unsupported page handling), normal pages (Quick Save + Summarize + About This Page all working).

**Where it lives:** `extension/content.js` (3-strategy extraction + unsupported detection), `extension/background.js` (`extractPageContent` + message handler), `extension/sidepanel.js` (consumer-specific truncation + unsupported handling). Vendor files: `extension/vendor/Readability.js`, `extension/vendor/Readability-readerable.js`.

---

### 23. Post-Retrieval Suggestion Chips

**What it does:** After every vault retrieval response (search or list), 2-3 clickable follow-up suggestion chips appear below the message. Click one and it sends as your next message — zero typing needed.

**How it works:**
1. The system prompt instructs the LLM to append a `<<SUGGESTIONS>>` block after vault retrieval responses
2. The parser extracts suggestions and strips the block from the displayed message
3. Chips render as magenta-tinted pill buttons below the response
4. Clicking a chip removes all chips, sets the text as input, and auto-sends

**Reliability layers:**
| Layer | What it handles |
|-------|----------------|
| Prompt (MANDATORY instruction) | LLM generates specific suggestions |
| Delimiter fallback | Handles both `\|\|` and `\|` separators (LLMs are inconsistent) |
| Regex order | Double-`<<` closing tag matched first to prevent stray `<` on last chip |
| Trailing `---` strip | Removes markdown horizontal rules the LLM sometimes adds before the block |
| Always-strip display | `<<SUGGESTIONS>>` block is removed from the message even if parsing fails |
| Client-side fallback | If LLM omits the block entirely, generic context-aware chips appear based on which tool was called |

**Test status:** PASS (2026-03-09) — LLM-generated chips render correctly after vault list. No raw markup visible. Chips are context-specific. Fallback chips verified when LLM omits the block.

**Where it lives:** `extension/sidepanel.js` (`parseSuggestions`, `renderSuggestionChips`, `isVaultRetrievalTurn`, `getFallbackSuggestions`), `extension/sidepanel.css` (`.suggestion-chips`, `.suggestion-chip`)

---

### 24. Image Capture & Vision

**What it does:** Paste any image from your clipboard into the side panel chat. NeuralTrace describes what it sees using a vision model and offers to save it to your vault — screenshots, articles, diagrams, anything visual.

**How it works:**
1. Paste event listener detects `image/*` items on the textarea
2. Image is resized (1024px max, JPEG 0.85 quality) via `resizeImage()` canvas
3. Preview row shows 60px thumbnails with X dismiss (max 3 images)
4. On send, images are routed to Gemini 2.0 Flash (vision model) via OpenRouter
5. Vision model describes the image; user clicks suggestion chip to save to vault
6. Follow-up text messages route back to Qwen 3.5 Flash with full tool access

**UX details:**
- Click any chat image → full-screen lightbox overlay, click anywhere to dismiss
- Chat persistence stores small 150px thumbnails (~3-5KB) so restored chats show real images
- Model badge updates dynamically: "Gemini Flash (vision)" for image turns, "Qwen 3.5 Flash" for text
- Image-only sends show just the thumbnail, no empty text bubble

**Test status:** PASS (2026-03-08) — 10/10 manual tests passing. Paste, remove, text fallthrough, image-only, image+text, follow-up, save chip, verify in vault, lightbox, persistence all verified.

**Where it lives:** `extension/sidepanel.js` (`addImage`, `removeImage`, `renderImagePreviews`, `resizeImage`, `currentTurnHasImages`, vision routing in `sendMessage`), `extension/sidepanel.html` (`#image-preview-row`), `extension/sidepanel.css` (`.image-preview-row`, `.message-image-thumb`, `.image-lightbox`)

---

### 25. Silent URL Capture for Image Traces

**What it does:** When you paste an image and save the vision description to your vault, the source page URL and title are automatically appended to the trace. You never have to manually note where an image came from.

**How it works:**
1. When `sendMessage()` detects images, it silently queries `chrome.tabs.query()` for the active tab's URL + title
2. Stores in `imageSourceContext` state variable
3. When `executeTool()` handles `save_trace` after a vision turn, appends `\nSource: [title](url)` to the content
4. Clears `imageSourceContext` after consumption to prevent stale URLs

**Design decisions:**
- Captures at **send time** (not paste or save time) — user might navigate away before clicking save
- `chrome://` URLs are filtered out
- State is consumed once — subsequent non-image saves don't get stale source URLs

**Test status:** PASS (2026-03-09) — Verified end-to-end: paste image on TechCrunch → save → retrieve → Source URL present and clickable. Backend confirmed trace #46 has correct source link.

**Where it lives:** `extension/sidepanel.js` (`imageSourceContext` state, URL capture in `sendMessage`, source append in `executeTool` `save_trace` case)

---

### 26. Vault Retrieval Formatting

**What it does:** Vault search and list results display in a clean, scannable format: bold title, description paragraph, clickable source link, and saved date — each on their own line.

**Format:**
```
**Title or summary**

Description paragraph with key details.

Source: [Page Title](url)

Saved: YYYY-MM-DD
```

**Also includes:** Mandatory "Saved to vault." confirmation after every save operation.

**Test status:** PASS (2026-03-09) — Format renders correctly with separate lines for source and saved date. Save confirmation displays after every save.

**Where it lives:** `extension/sidepanel.js` (system prompt formatting rules)

---

### 27. Quick Guide Overlay

**What it does:** An in-app cheat sheet showing all 12 user-facing features, accessible via a `?` icon in the header. Helps new users discover what NeuralTrace can do without leaving the side panel.

**How it works:** Click the `?` icon in the header-left area. A full-screen overlay appears with features grouped into 3 sections: "Engines & Saving", "Inputs & Actions", and "Navigation". Tap anywhere to dismiss.

**Design:** Text-only layout (no emoji icons), section headers in small caps, two layout styles — items with chat commands show italic hints below, items with shortcuts show the shortcut right-aligned. Follows established UX patterns from Gmail, Figma, and Trello.

**Test status:** PASS (2026-03-09) — Overlay opens on `?` click, dismisses on tap anywhere, all 12 features listed correctly, scrollable on smaller viewports.

**Where it lives:** `extension/sidepanel.html` (`#guide-overlay` markup + `#btn-guide` button), `extension/sidepanel.css` (guide styles), `extension/sidepanel.js` (DOM refs + event listeners)

---

## Feature Summary

| # | Feature | Type | You Can Test It? | Status |
|---|---------|------|------------------|--------|
| 1 | Add Trace | MCP Tool | Yes | PASS |
| 2 | Search Memory | MCP Tool | Yes | PASS |
| 3 | Delete Trace | MCP Tool | Yes | PASS |
| 4 | Cross-Vendor Sharing | Architecture | Yes | PASS |
| 5 | Web Dashboard | UI | Yes | PASS |
| 6 | REST API + CLI | API | Yes | PASS |
| 7 | Hybrid Search Scoring | Backend (ranking) | Indirectly | PASS |
| 8 | Metadata Filtering | MCP Tool param | Yes | PASS |
| 9 | Recency Weighting | Backend (ranking) | Indirectly | PASS |
| 10 | MCP Auto-Recall | MCP Instructions | Yes | PASS |
| 11 | Suggest Traces | MCP Tool | Yes | PASS |
| 12 | Side Panel Chat | Extension | Yes | PASS |
| 13 | Extension Vault Search | Extension | Yes | PASS |
| 14 | Extension Save + Dedup | Extension | Yes | PASS |
| 15 | Page Context Awareness | Extension | Yes | PASS |
| 16 | List Traces (Overview) | Extension | Yes | PASS |
| 17 | Chat Persistence | Extension | Yes | PASS |
| 18 | Chat History UI | Extension | Yes | PASS |
| 19 | Voice-to-Text Input | Extension | Yes | PASS |
| 20 | Context Menu — Remember This | Extension | Yes | PASS |
| 21 | Context Menu — Remember This Page | Extension | Yes | PASS |
| 22 | Smart Page Content Extraction | Extension | Indirectly | PASS |
| 23 | Post-Retrieval Suggestion Chips | Extension | Yes | PASS |
| 24 | Image Capture & Vision | Extension | Yes | PASS |
| 25 | Silent URL Capture | Extension | Indirectly | PASS |
| 26 | Vault Retrieval Formatting | Extension | Yes | PASS |
| 27 | Quick Guide Overlay | Extension | Yes | PASS |

| 28 | Quick Save (No LLM) | Extension | Yes | PASS |
| 29 | Slash Commands | Extension | Yes | PASS |
| 30 | Background Trace Enrichment | Extension + Server | Indirectly | PASS |
| 31 | Context-Aware Action Chips | Extension | Yes | PASS |
| 32 | Calendar Link Generation | Extension | Yes | PASS (Google, Outlook, iCal all verified) |
| 33 | Intermediate Text Suppression | Extension | Indirectly | PASS |
| 34 | SUGGESTIONS Streaming Fix | Extension | Indirectly | PASS |
| 35 | Summarize Page | Extension | Yes | PASS |
| 36 | Quick Action Buttons | Extension | Yes | PASS |
| 37 | Copy Response Button | Extension | Yes | PASS |
| 38 | Markdown Heading Rendering | Extension | Indirectly | PASS |

---

## Extension Features (v1.3 — Built 2026-03-16)

---

### 28. Quick Save (No LLM)

**What it does:** The "Save this page" chip and `/save-page` slash command save pages instantly by bypassing the LLM entirely. Sub-second save vs the previous 5-second LLM round-trip.

**How it works:**
1. Extracts page title, URL, and first 3,000 chars of clean text (via 3-strategy pipeline)
2. Auto-generates tags from the page title
3. Calls `/api/trace` POST directly — no LLM involved
4. Shows instant "Saved to vault. [Page Title]" confirmation

**How to use it:**
- Click the "Save this page" chip on the welcome screen
- Or type `/save-page` in any conversation

**Test status:** PASS — sub-second save verified on multiple Meetup pages

---

### 29. Slash Commands

**What it does:** Type `/` in the chat input to see a dropdown of available commands. Keyboard-navigable, filterable by typing.

**Built-in commands:**
| Command | Action | Uses LLM? |
|---------|--------|-----------|
| `/save-page` | Save current page to vault | No |
| `/summarize-page` | Summarize and review current page | Yes |
| `/search [query]` | Search your vault | Yes |
| `/list` | Show recent traces | Yes |
| `/delete [id]` | Delete a trace | Yes |
| `/new` | Start new conversation | No |
| `/settings` | Open settings panel | No |
| `/help` | Open quick guide | No |

**How it works:** Input listener detects `/` as first character, shows a filtered dropdown above the input. Arrow keys navigate, Enter selects, Escape dismisses. Commands without args execute immediately. Commands with args (search, delete) populate the input for the user to complete.

**Test status:** PASS — all 7 commands verified

---

### 30. Background Trace Enrichment

**What it does:** After every save, a background LLM call silently classifies the trace (event, article, person, preference, etc.) and extracts structured metadata (dates, locations, organizers). The user sees nothing — it happens after the instant save confirmation.

**How it works:**
1. Save completes → instant confirmation shown to user
2. 500ms later, `enrichTrace()` fires in the background
3. Content is truncated to 2,000 chars to prevent large-page failures
4. LLM classifies content type and extracts structured fields
5. PATCH `/api/trace/:id` updates the trace's `metadata` column
6. When user retrieves the trace later, metadata enables action chips

**Trigger points:** All three save paths trigger enrichment:
- Quick save chip / `/save-page` → `quickSavePage()` calls `enrichTrace()`
- Chat "save this" → `save_trace` tool calls `enrichTrace()`
- Right-click "Remember this page" → background.js saves, side panel's `trace-saved` listener calls `enrichTrace()`

**Metadata schema (events):**
```json
{
  "type": "event",
  "event": {
    "title": "Blockchain for Beginners",
    "start": "2026-03-31T18:15:00",
    "end": "2026-03-31T20:45:00",
    "timezone": "America/Chicago",
    "location": "Improving, 5445 Legacy Dr, Plano TX",
    "organizer": "DFW Emerging Technologies",
    "allDay": false
  }
}
```

**All-day events:** When no specific time is present, `allDay: true` with date-only format (`YYYY-MM-DD`).

**Known limitation:** The enrichment LLM occasionally extracts incorrect dates/years. Calendar buttons use whatever the LLM provides — users should verify dates before saving.

**Test status:** PASS — enrichment verified via database inspection. All three save paths confirmed. All-day and timed events both work.

---

### 31. Context-Aware Action Chips

**What it does:** When a search result contains enriched event metadata, action chips appear below the LLM's suggestion chips. These are contextual actions specific to the content type — currently calendar actions for events.

**How it works:**
1. Search API returns traces with `metadata` field
2. Extension checks if any result has `metadata.type === "event"`
3. If yes, renders action chips: "Add to Google Calendar", "Add to Outlook", "Download .ics"
4. Chips appear in purple (distinct from coral suggestion chips)

**Test status:** PASS — action chips render correctly for enriched event traces

---

### 32. Calendar Link Generation

**What it does:** Generates pre-filled calendar links for all three major calendar platforms from event metadata. No OAuth, no API keys — pure URL-based.

**Supported calendars:**
- **Google Calendar** — `action=TEMPLATE` URL with title, dates, timezone, location, description
- **Outlook Web** — `outlook.office.com` compose URL (supports both M365 and personal accounts)
- **iCal (.ics)** — RFC-5545 compliant file download, works with Apple Calendar, Outlook desktop, any calendar app

**All-day support:** Events with `allDay: true` use date-only formats: Google (`YYYYMMDD`), Outlook (`allday=true`), iCal (`DTSTART;VALUE=DATE`).

**Test status:** PASS — All three platforms verified (2026-03-21). Title, location, organizer, all-day flag all populate correctly.

---

### 33. Intermediate Text Suppression

**What it does:** When the LLM "thinks out loud" before a tool call (e.g., "I'll save that to your vault. Let me get the page context first"), those intermediate messages are hidden. Only the final response after tool execution is shown.

**How it works:** When tool calls are detected in the streaming response, any existing message element is removed before executing tools. The second `streamResponse()` call creates a fresh message for the final answer.

**Test status:** PASS — no more double-bubble or "narration" messages during tool calls

---

### 34. SUGGESTIONS Streaming Fix

**What it does:** Prevents the raw `SUGGESTIONS>>...SUGGESTIONS>>` markup from flashing on screen during streaming. The markup is stripped in real-time as tokens arrive, not just at the end.

**How it works:**
- `updateMessageContent()` strips everything from the first `SUGGESTIONS` marker onward during streaming
- `parseSuggestions()` regex broadened to handle LLM format variations (missing angle brackets)
- Full text preserved in `assistantText` for proper parsing after stream completes

**Test status:** PASS — no flash, suggestions parsed correctly into chips

---

### 35. Summarize Page

**What it does:** One-click page summarization. Generates a detailed, structured summary of the current browser tab and offers to save it to the vault.

**How it works:**
1. User clicks "Summarize Page" quick action button above the input
2. Extension extracts page content via 3-strategy pipeline (JSON-LD → Readability.js → CSS selector), up to 10,000 chars
3. Sends clean content to LLM with a prompt requesting detailed summary with markdown headers and bullet points
4. User message shows clean "Summarize this page: [title]" (full page content is hidden from chat display)
5. After summary streams, an "Add to vault" suggestion chip appears
6. Clicking "Add to vault" sends the request to the LLM which saves the summary via `save_trace`

**How to use it:** Click the "Summarize Page" button above the chat input on any webpage.

**Test status:** PASS — Tested on Conference Board CHRO Summit page (2026-03-21). Summary accurate: event name, date, venue, topics, speakers, agenda all correct. "Add to vault" chip appeared and saved successfully.

---

### 36. Quick Action Buttons

**What it does:** Persistent row of quick-action buttons directly above the chat input. Always visible — survives across conversations.

**Buttons:**
| Button | Action | Uses LLM? |
|--------|--------|-----------|
| Save Page | Calls `quickSavePage()` — sub-second, no LLM | No |
| Summarize Page | Extracts page content, sends to LLM for detailed summary | Yes |
| Show recent traces | Sends "Show my recent traces" to LLM | Yes |

**How it works:** Horizontally scrollable container with `overflow-x: auto` and hidden scrollbar. Buttons don't wrap — user swipes/scrolls horizontally on narrow panels.

**Test status:** PASS — all three buttons functional, horizontal scroll works on narrow panel widths

---

### 37. Copy Response Button

**What it does:** A copy icon appears below every NeuralTrace response on hover. One click copies the full response text to clipboard with a checkmark confirmation.

**How it works:**
1. `appendMessage()` adds a copy button (`msg-copy-btn`) to every assistant message with content
2. Button is invisible by default, appears on `.message.assistant:hover`
3. Click triggers `navigator.clipboard.writeText()` with the message's `innerText`
4. Icon switches to a checkmark for 2 seconds, then reverts

**Test status:** PASS — copies text correctly, checkmark feedback works

---

### 38. Markdown Heading Rendering

**What it does:** `renderMarkdown()` now converts `##` and `###` markdown headers into styled HTML headings instead of displaying them as raw text.

**How it works:**
- `##` → `<h3>` styled with coral accent color (14px, 600 weight)
- `###` → `<h4>` styled with magenta accent color (13.5px, 600 weight)
- Headings are excluded from `<p>` tag wrapping

**Test status:** PASS — headers render correctly in Summarize Page output

---

## Test Documentation

- **Original features (1-6):** See [demo-test-checklist.md](../testing/demo-test-checklist.md) — 21/21 tests passing
- **Enhanced features (7-11):** All PASS — tested 2026-03-07 via backend API and deployed server verification
- **Extension features (12-19):** All PASS — tested 2026-03-08 in Chrome with unpacked extension
- **Extension features (20-22):** All PASS — tested 2026-03-09 in Chrome. Context menus verified on TechCrunch. AI page summary verified vs old nav-junk capture.
- **Extension feature (23):** PASS — tested 2026-03-09. Suggestion chips render after vault retrieval, LLM-specific and fallback modes both working.
- **Extension features (28-34):** Built and tested 2026-03-16 during S04 UAT. Quick save, slash commands, enrichment, calendar actions, streaming fixes all verified.
- **Content extraction upgrade (v1.4.1):** Tested 2026-03-22. 3-strategy pipeline (JSON-LD → Readability.js → CSS fallback), tiered limits, graceful failure on unsupported pages. UAT passed on Guardian article (Summarize, Quick Save, About This Page).
- **Extension features (24-27):** All PASS — tested 2026-03-09. Image paste + vision model + vault save pipeline working. Silent URL capture verified on backend (trace #46). Retrieval format clean with separate lines. Quick guide overlay opens/dismisses correctly.
- **Settings simplification (v1.4.2):** Tested 2026-03-22. Progressive disclosure — Advanced toggle hides MCP/OpenRouter/Server URL for cloud users. Self-hosted auto-expands. Click-outside-to-close.
- **Model switcher (v1.5.0):** Tested 2026-03-22. All 4 Pro models verified (GPT 5, Claude Sonnet 4.5, Gemini 2.5 Pro, Gemini 2.5 Flash). Persistence, click-outside, server whitelist all working. Deployed to VPS.
- **OAuth 2.1 for MCP (v1.6.0):** Deployed 2026-03-22. UAT passed on Claude.ai (search vault → found traces) + Claude Cowork (find last trace → correct). ChatGPT not tested (platform-side issue).
