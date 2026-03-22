# NeuralTrace Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [1.0.0] — 2026-03-22

Initial open-source release.

### Core
- **MCP Server** — Dual transport: SSE (`/sse`) and Streamable HTTP (`/mcp`). Works with Claude, ChatGPT, Cursor, VS Code, and any MCP-compatible client.
- **SQLite Vault** — Per-user memory storage via `better-sqlite3`. Zero external database dependencies.
- **Semantic Search** — Vector embeddings via OpenAI `text-embedding-3-small`. Find memories by meaning, not just keywords.
- **3 MCP Tools** — `add_trace` (save), `search_neuraltrace_memory` (search), `delete_trace` (remove).
- **OAuth 2.1 + PKCE** — Connects to web AI platforms (Claude.ai, ChatGPT) via standard OAuth flow.
- **REST API** — Health check, admin dashboard, auth endpoints, AI proxy.
- **Docker Support** — Dockerfile + docker-compose.yml for one-command deployment.
- **CLI Tool** — `bin/trace` for saving memories from any terminal.

### Chrome Extension
- **Side Panel Chat** — Memory-first AI chat available on every page via browser side panel.
- **Quick Save** — One-click page capture. No LLM round-trip, sub-second saves.
- **Summarize Page** — Full page summarization with "Add to vault" option.
- **Quick Action Buttons** — Persistent row: Save Page, Summarize Page, Show recent traces.
- **7 Slash Commands** — `/save-page`, `/summarize-page`, `/search`, `/list`, `/delete`, `/new`, `/help`.
- **Background Enrichment** — Auto-classifies saved pages with tags, dates, locations.
- **Context-Aware Actions** — Calendar chips (Google, Outlook, iCal) for event traces.
- **Image Capture** — Paste/drop screenshots for vision analysis.
- **Voice Input** — Speech-to-text via browser API.
- **Context Menus** — Right-click "Save Page" and "Remember this" (selection).
- **Chat Persistence** — Conversations survive panel close/reopen.
- **Chat History** — Browse and resume past conversations.
- **Model Switcher** — Choose between multiple AI models.
- **Content Extraction** — 3-strategy pipeline: JSON-LD → Readability.js → CSS fallback.
- **Markdown Rendering** — Headings, bold, code blocks, lists in responses.
- **Copy Response** — One-click copy on any AI response.

### Self-Hosted
- **Local-first defaults** — Server and extension default to `localhost:3000`.
- **`.env.example`** — All configuration documented with comments.
- **Admin password auth** — Simple single-user authentication for self-hosted mode.
