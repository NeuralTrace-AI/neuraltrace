# NeuralTrace Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [1.6.0] — 2026-03-22

### Added
- **OAuth 2.1 for MCP** — Full OAuth 2.1 with PKCE support for Claude.ai, ChatGPT, and Claude Cowork custom connectors. Discovery endpoint (`/.well-known/oauth-authorization-server`), authorization with consent screen, token exchange, refresh tokens, and revocation. Users can now connect their vault from any consumer AI platform by pasting `https://neuraltrace.ai`. Existing auth (API keys, JWT, magic link) unchanged.
- **New server file:** `src/oauth.ts` — all OAuth logic (discovery, authorize, consent, token, revoke, validation)
- **3 new database tables:** `oauth_clients`, `oauth_codes`, `oauth_tokens` in system.db (additive, existing tables untouched)
- **`extractMcpUserId()` updated** — now accepts `ntoauth_*` bearer tokens as fallback after `nt_*` API key check. Existing API key path unchanged.
- **`cookie-parser` dependency** — required for OAuth session management during consent flow

---

## [1.5.0] — 2026-03-22

### Added
- **Model switcher** — Claude-style dropdown in top-left header. Pro cloud users get 4 models: GPT 5, Claude Sonnet 4.5, Gemini 2.5 Pro, Gemini 2.5 Flash. BYOK users get 4 curated picks + custom model input. Free users stay locked to DeepSeek V3.2. Selection persists across panel close/reopen. Server-side whitelist prevents cost abuse.

### Changed
- **Pro default model** — Upgraded from Gemini 2.5 Flash to Gemini 2.5 Pro.
- **BYOK label** — Renamed "OpenRouter API Key" to "AI API Key" with hint for openrouter.ai.
- **Plan badge removed from header** — Pro status implied by model dropdown presence. Plan still visible in settings.
- **Settings panel simplification** — Progressive disclosure: MCP API Key, AI API Key, Server URL hidden behind collapsible "Advanced" toggle. Click outside settings to close.

---

## [1.4.2] — 2026-03-22

### Changed
- **Settings panel simplification** — Progressive disclosure: MCP API Key, OpenRouter Key, Server URL, and Save button are now hidden behind a collapsible "Advanced" toggle. Cloud users see only Account + "Advanced >". Self-hosted users get Advanced auto-expanded. Click outside settings to close.

---

## [1.4.1] — 2026-03-22

### Changed
- **Content extraction upgrade** — 3-strategy pipeline: JSON-LD `articleBody` (cleanest) → Mozilla Readability.js (strips ads/nav/sidebars) → CSS selector fallback. Replaces the old single-selector cascade.
- **Tiered content limits** — Summarize Page: 10K chars (was 3K). Get Page Context: 4K. Context menu: 3K. Quick Save: 3K (unchanged). Background summary max_tokens: 600 (was 300).
- **Graceful failure on unsupported pages** — chrome://, chrome-extension://, about:, edge:// pages now show clear "not supported" messages instead of empty/confusing results.

### Added
- **Readability.js** — Vendored Mozilla Readability.js + readerable.js in `extension/vendor/`. Loaded via manifest content_scripts.

---

## [1.4.0] — 2026-03-21

### Added
- **Summarize Page** — One-click page summarization via quick action button. Extracts page content, generates detailed summary with headers and bullet points, offers "Add to vault" to save the summary.
- **Quick Action Buttons** — Persistent row above chat input: "Save Page", "Summarize Page", "Show recent traces". Horizontally scrollable, always visible.
- **Copy Response Button** — Copy icon appears below every NeuralTrace response on hover. Copies full text to clipboard with checkmark confirmation.
- **Markdown heading rendering** — `##` and `###` now render as styled headings (coral and magenta accents) instead of raw text.

### Changed
- **Chat UI redesign** — Messenger-style layout: user messages right-aligned with fitted width, assistant messages borderless, name labels removed, input area streamlined.
- **Settings icon** — Replaced gear with vertical 3-dot menu icon.
- **Input area** — Mic button moved inside text input, send button is now circular, model badge and shortcut hint removed, border-top and background removed for cleaner look.

## [1.3.2] — 2026-03-21

### Changed
- **Keyboard shortcut** — Changed from `Cmd+Shift+N` (conflicted with Chrome incognito) to `Alt+Shift+N`.
- **Outlook calendar URL** — Switched from `outlook.live.com` to `outlook.office.com` for Microsoft 365/work account support.
- **Enrichment prompt** — Events without explicit times now set `allDay: true` instead of fabricating a start time. Added "NEVER fabricate a start time" rule.
- **Enrichment content truncation** — Content sent to enrichment LLM is now truncated to 2,000 chars. Prevents large pages (ticket listings, long articles) from failing the LLM call.
- **Enrichment max_tokens** — Increased from 300 to 800. Previous limit caused JSON truncation (`finish_reason: "length"`) and silent enrichment failures.
- **Calendar link generation** — Now supports all-day events with proper formats for Google (date-only `YYYYMMDD`), Outlook (`allday=true`), and iCal (`DTSTART;VALUE=DATE`).

### Fixed
- **Stale calendar chips** — `pendingEventActions` was only updated when search results contained events, so old event data persisted across searches. Now always resets on every search.
- **Background save missing enrichment** — Right-click "Remember this page" (background.js) saved traces without triggering enrichment. Side panel's `trace-saved` listener now calls `enrichTrace()`.
- **Enrichment errors swallowed silently** — LLM call failures logged nothing. Now logs status code on failure.

### Known Limitations
- **Enrichment date accuracy** — The enrichment LLM occasionally extracts incorrect dates/years from page content. Calendar buttons faithfully use whatever dates the LLM provides. Users should verify dates before saving calendar events.

---

## [1.3.1] — 2026-03-20

### Added
- **Privacy policy page** — `https://neuraltrace.ai/privacy` with full data collection, third-party services, permissions, and rights disclosures. Required for CWS submission.
- **Web search feature plan** — `docs/roadmap/web-search-plan.md` (deferred, planned for post-launch).

### Changed
- **System prompt** — AI now answers any question (was rejecting non-vault queries). Vault search is invisible — never mentions "I didn't find anything in your vault." Offers to save naturally instead of sending users to other AI tools.
- **Conversation titles** — Image-only conversations now use the AI's description as the title instead of "[Image]".
- **Upgrade to Pro button** — Added to settings panel. Opens Paddle checkout with auth token. Auto-hides when already on Pro.

### Fixed
- **B07:** System prompt exposed vault internals — general questions like "What's the capital of France?" triggered visible "I don't see anything in your vault" messaging. Updated rules 1, 5, 8 in SYSTEM_PROMPT.
- **B08:** Temp UAT `chrome.storage.local.clear()` was still in `init()` — wiped auth on every panel open, making it look like closing the extension logged you out. Removed.
- **B09:** Image paste failed with "Upstream AI error" for cloud users — proxy overrode vision model with plan model. Now allows Gemini Flash vision model override.
- **B10:** Text follow-up after image paste failed — chat history contained base64 image data sent to DeepSeek. Now strips images from history for non-vision models.

---

## [1.3.0] — 2026-03-16

### Added
- **Quick Save (no LLM)** — "Save this page" chip and `/save` bypass the LLM entirely. Sub-second save via direct API call. Auto-generates tags from page title.
- **Slash Commands** — Type `/` in chat input to see 7 built-in commands: `/save`, `/search`, `/list`, `/delete`, `/new`, `/settings`, `/help`. Filterable dropdown with keyboard navigation.
- **Background Trace Enrichment** — After every save, a silent LLM call classifies the trace (event, article, person, etc.) and extracts structured metadata (dates, locations, organizers). Stored in new `metadata` column.
- **Context-Aware Action Chips** — When searching for an enriched event trace, calendar action chips appear: "Add to Google Calendar", "Add to Outlook", "Download .ics". Purple styling distinct from suggestion chips.
- **Calendar Link Generation** — Pre-filled links for Google Calendar (action=TEMPLATE), Outlook Web (rru=addevent), and iCal (.ics file download). No OAuth needed.
- **PATCH `/api/trace/:id` endpoint** — Updates trace metadata. Used by background enrichment.
- **`metadata` column** on traces table — JSON field for structured data (auto-migrates on startup).
- **`deploy.sh`** — Safe deploy script with .env backup + exclusions. Replaces ad-hoc rsync.

### Changed
- **Onboarding tour** — Last step now highlights quick guide (?) button instead of save chip. Step counter removed. Copy updated for all 4 steps.
- **Plan badge** — Moved from footer to header-left, next to guide button.
- **Guide button** — Styled to match header-right icons (was unstyled white).
- **Page context bar** — Auto-dismisses after 5 seconds.
- **Page excerpt limit** — Increased from 1,500 to 3,000 characters for better content capture.
- **Enrichment prompt** — Improved to always extract location, timezone, and estimate end time for events.
- **Suggestion prompt** — LLM instructed to never suggest calendar actions (extension handles those).
- **Proxy** — Now respects `stream: false` from client requests (was hardcoded to `stream: true`).
- **`initSystemDb()`** — Now runs in both cloud and selfhosted modes (was gated behind `IS_CLOUD`).
- **Search API** — Results now include `metadata` field from traces.
- **`getAllTraces` / `searchTracesFiltered`** — Queries now include `metadata` column.

### Fixed
- **B01:** Onboarding last step highlighted wrong element (chip instead of guide button)
- **B02:** Empty "NEURALTRACE" bubble appeared above tool-call responses — removed entire `.message` container when assistantText is empty
- **B03:** `SUGGESTIONS>>` markup leaked into displayed text — broadened regex parser + real-time streaming strip in `updateMessageContent()`
- **B04:** Background enrichment never ran for cloud users — was only checking `CONFIG.openrouterKey` (empty for cloud). Now routes through server proxy.
- **B05:** Production .env overwritten by rsync deploy — created `deploy.sh` with `--exclude='.env'`
- **B06:** `initSystemDb()` only ran in cloud mode — auth failed in selfhosted with "no such table: magic_tokens"
- **Quick save chip handler** — `showWelcome()` re-binding was missing the `quickSavePage()` fast path. New conversations would fall back to slow LLM save.
- **Intermediate text suppression** — LLM "thinking out loud" messages before tool calls now hidden. Only final response shown.

---

## [1.1.0] — 2026-03-09

### Added
- Post-retrieval suggestion chips (LLM-generated + fallback)
- Context menu: "Remember this with NeuralTrace" (selection)
- Context menu: "Remember this page" (full page)
- Smart page content extraction (cleans nav/ads from captured text)
- Image capture & vision (paste/drop screenshots, Gemini Flash analysis)
- Silent URL capture (source attribution for image pastes)
- Vault retrieval formatting (structured display with title, source, date)
- Quick guide overlay

---

## [1.0.0] — 2026-03-08

### Added
- Chrome extension side panel with AI chat
- 5 vault tools: search, save, delete, list, page context
- Voice-to-text input
- Chat persistence (conversations survive panel close/reopen)
- Chat history UI (browse and resume past conversations)
- Onboarding tour (4-step tooltip walkthrough)

---

## [0.1.0] — 2026-03-06

### Added
- Remote MCP server over SSE + Streamable HTTP (dual transport)
- SQLite memory vault via `better-sqlite3`
- 3 MCP tools: `add_trace`, `search_neuraltrace_memory`, `delete_trace`
- Semantic search via OpenAI embeddings
- Docker deployment on GSD VPS
- Admin dashboard (password-protected)
- 21/21 features passing across 6 clients
