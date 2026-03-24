<p align="center">
  <img src="public/logo-full.png" alt="NeuralTrace" width="400">
</p>

<p align="center">
  <strong>Capture anything you browse. Every AI remembers it.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://github.com/NeuralTrace-AI/neuraltrace/stargazers"><img src="https://img.shields.io/github/stars/NeuralTrace-AI/neuraltrace" alt="Stars"></a>
  <a href="https://github.com/NeuralTrace-AI/neuraltrace/issues"><img src="https://img.shields.io/github/issues/NeuralTrace-AI/neuraltrace" alt="Issues"></a>
</p>

---

NeuralTrace is an open-source browser memory layer for AI agents. Save pages, notes, and context from your browser into a personal vault — then access it from any AI tool via [MCP](https://modelcontextprotocol.io) (Model Context Protocol).

**The problem:** Every AI tool starts from zero. You explain the same preferences, decisions, and context over and over — to ChatGPT, Claude, Gemini, Copilot. We call this the "Amnesia Tax."

**The fix:** Save it once in NeuralTrace, and every AI remembers it. Your vault connects to any MCP-compatible tool automatically.

## Features

- **Chrome Extension** — Side panel AI chat with memory-powered responses. Save pages, summarize content, search your vault — all without leaving the browser.
- **MCP Server** — Dual transport (SSE + Streamable HTTP) works with Claude, ChatGPT, Cursor, VS Code, and any MCP client.
- **Semantic Search** — Find memories by meaning, not just keywords. Works with Ollama, OpenAI, LocalAI, LM Studio, or any OpenAI-compatible embedding provider.
- **Quick Save** — One-click page capture. No AI round-trip, sub-second saves.
- **Background Enrichment** — Saved pages are automatically classified with tags, dates, and locations.
- **Local-First** — Your data stays on your machine. SQLite vault, no cloud required.
- **Self-Hosted** — Run the full stack on your own hardware with Docker.

## Prerequisites

- **Node.js 18+** (LTS recommended — [download](https://nodejs.org/)). Older versions will fail to compile `better-sqlite3`.
- **Docker** (optional, for containerized deployment)

## Quick Start

### Option 1: Docker (recommended)

```bash
git clone https://github.com/NeuralTrace-AI/neuraltrace.git
cd neuraltrace
cp .env.example .env
# Edit .env — set ADMIN_PASSWORD (and optionally EMBEDDING_PROVIDER_URL for semantic search)
docker compose up -d
```

Server runs at `http://localhost:3000`. Health check: `curl http://localhost:3000/health`

### Option 2: Run from source

```bash
git clone https://github.com/NeuralTrace-AI/neuraltrace.git
cd neuraltrace
npm install
cp .env.example .env
# Edit .env — set ADMIN_PASSWORD (and optionally EMBEDDING_PROVIDER_URL for semantic search)
npm run build
npm start
```

### Load the Chrome Extension

1. Open `chrome://extensions` in Chrome or Edge
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `extension/` folder
4. Click the NeuralTrace icon to open the side panel
5. Click **"Use settings"** (self-hosted)
6. In the **Auth Token** field, enter the `ADMIN_PASSWORD` you set in `.env`
7. Start chatting — use `/save-page` to save any page, `/search` to find memories

## Embedding Providers

NeuralTrace supports any OpenAI-compatible embedding endpoint. Configure it in `.env`:

| Provider | URL | API Key | Notes |
|----------|-----|---------|-------|
| Ollama (recommended) | `http://localhost:11434/v1` | Not needed | Free, local, private |
| OpenAI | `https://api.openai.com/v1` | Required | Cloud, paid |
| LocalAI | `http://localhost:8080/v1` | Not needed | Free, local |
| LM Studio | `http://localhost:1234/v1` | Not needed | Free, local |

Set `EMBEDDING_PROVIDER_URL` and `EMBEDDING_MODEL` in your `.env`. If neither is set, search falls back to keyword matching. The legacy `OPENAI_API_KEY` variable still works for backwards compatibility — NeuralTrace will auto-configure OpenAI if it's present and `EMBEDDING_PROVIDER_URL` is not set.

## Connect Your AI Tools

NeuralTrace speaks MCP, so any compatible tool can read and write to your vault.

### Claude Code / Cursor / VS Code

Add to your MCP config (e.g., `~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "neuraltrace": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

### Claude.ai / ChatGPT (OAuth)

Use `http://localhost:3000/mcp` as the server URL. NeuralTrace supports OAuth 2.1 with PKCE for web-based AI platforms.

## MCP Tools

| Tool | Description |
|------|-------------|
| `add_trace` | Save a memory (content + tags) to your vault |
| `search_neuraltrace_memory` | Semantic search across your vault |
| `delete_trace` | Remove a memory by ID |

## Architecture

```
Browser ──► Chrome Extension (side panel chat)
                    │
                    ▼
              NeuralTrace Server (Express.js)
              ├── MCP Transport (SSE + Streamable HTTP)
              ├── REST API (auth, proxy, billing)
              ├── SQLite Vault (per-user)
              └── Embeddings (Ollama, OpenAI, LocalAI, etc.)
                    │
                    ▼
        Claude / ChatGPT / Cursor / any MCP client
```

## Configuration

See [`.env.example`](.env.example) for all available options. Key settings:

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_PASSWORD` | Yes | Protects your vault — also used as Auth Token in the Chrome extension |
| `EMBEDDING_PROVIDER_URL` | No | OpenAI-compatible embedding endpoint (e.g. `http://localhost:11434/v1` for Ollama). If omitted, search uses keyword matching only. |
| `EMBEDDING_MODEL` | No | Embedding model name (e.g. `nomic-embed-text` for Ollama, `text-embedding-3-small` for OpenAI) |
| `EMBEDDING_API_KEY` | No | API key for the embedding provider. Not needed for Ollama/LocalAI/LM Studio. |
| `OPENAI_API_KEY` | No | Legacy option — if set and `EMBEDDING_PROVIDER_URL` is not, NeuralTrace auto-configures OpenAI embeddings. |
| `PORT` | No | Server port (default: 3000) |
| `NEURALTRACE_MODE` | No | `selfhosted` (default) or `cloud` |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md) for responsible disclosure.

## License

[Apache 2.0](LICENSE) — use it, modify it, ship it.
