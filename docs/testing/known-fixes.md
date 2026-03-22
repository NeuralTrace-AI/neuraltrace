# Known Fixes & Root Causes

Permanent log of bugs, root causes, and fixes. Prevents repeat mistakes across sessions.

**Rule:** After fixing any bug, add an entry here in the same action. Include the root cause — not just what was fixed, but WHY it broke.

---

## Extension — Chat UI

### Empty bubble above tool-call responses (B02)
- **Symptom:** An empty "NEURALTRACE" label + bubble appeared before the actual response when the LLM made tool calls
- **Root cause:** `appendMessage()` returns `contentDiv`, not the outer `.message` div. When the empty message was removed via `msgEl.remove()`, only the content was removed — the label stayed.
- **Fix:** Changed to `msgEl.closest(".message")?.remove()` to remove the entire container. Also suppressed all intermediate text during tool-call rounds (not just empty text).
- **File:** `extension/sidepanel.js` — tool call handling section
- **Date:** 2026-03-16

### Text follow-up after image paste fails with "Upstream AI error" (B10)
- **Symptom:** After pasting an image and getting a vision response, any text follow-up in the same conversation failed with "Upstream AI error"
- **Root cause:** `chatHistory` stored image messages with base64 data. On text-only follow-ups, the entire history (including images) was sent to DeepSeek, which doesn't support image inputs.
- **Fix:** Added `sanitizedHistory` in `streamResponse()` — when sending to a non-vision model, strips image data from history entries and replaces with `[Image was shared]` text placeholder.
- **File:** `extension/sidepanel.js` — `streamResponse()` function
- **Lesson:** When supporting multiple models with different capabilities (text-only vs multimodal), the history must be sanitized per-model before sending.
- **Date:** 2026-03-19

### Image paste fails with "Upstream AI error" for cloud users (B09)
- **Symptom:** Pasting an image into chat returned "Upstream AI error" for cloud users
- **Root cause:** Proxy is server-authoritative — it overrides the client's model with the plan model (`deepseek/deepseek-v3.2` for free). The extension sent `model: "google/gemini-2.0-flash-001"` for vision, but the proxy ignored it. DeepSeek doesn't support image inputs.
- **Fix:** Proxy now checks if client requests the specific vision model (`google/gemini-2.0-flash-001`) and allows it. All other model requests still use plan model.
- **File:** `src/proxy.ts` — `handleChatProxy()` function
- **Lesson:** When the proxy is server-authoritative, any feature that needs a different model (vision, code, etc.) must be explicitly whitelisted. Don't assume the plan model handles all modalities.
- **Date:** 2026-03-19

### Temp UAT storage clear left in init() — auth wiped on every panel open (B08)
- **Symptom:** Every time the side panel was closed and reopened, user was logged out and shown the auth screen
- **Root cause:** `chrome.storage.local.clear()` was added at the top of `init()` for T01 fresh-install testing and never removed. It ran on every panel open, wiping JWT, email, plan, and all config.
- **Fix:** Removed the two temp lines (`chrome.storage.local.clear()` + console.log) from `init()`.
- **File:** `extension/sidepanel.js` — `init()` function (was line 649-650)
- **Lesson:** Temp debug/test code must be removed immediately after the test it supports. Add `// [TEMP]` comments AND track removal in the resume checklist — but don't rely on future sessions to clean up.
- **Date:** 2026-03-19

### System prompt exposes vault internals and rejects general questions (B07)
- **Symptom:** Asking "What's the capital of France?" returned "I don't see any information about France's capital in your vault..." before answering. Also told users to "try Claude or ChatGPT" for non-vault questions.
- **Root cause:** Three system prompt rules: (1) "ALWAYS search the vault first" for every question, (2) "If the vault has no relevant results, say so honestly" — exposed internal search, (3) "You are NOT a general-purpose AI" — rejected valid questions.
- **Fix:** Rule 1: removed "ALWAYS", search vault when relevant. Rule 5: vault search is invisible, never mention failed searches. Rule 8: answer any question, offer to save naturally.
- **File:** `extension/sidepanel.js` — `SYSTEM_PROMPT` constant (lines 107, 111, 114)
- **Lesson:** The vault search is plumbing — users should never see it. The AI should answer first, memory-enhance when possible, and never send users to other tools.
- **Date:** 2026-03-19

### SUGGESTIONS markup flashing during streaming (B03)
- **Symptom:** Raw `SUGGESTIONS>>...SUGGESTIONS>>` text briefly visible before being parsed into chips
- **Root cause:** Two issues: (1) `parseSuggestions()` regex only matched `<<SUGGESTIONS>>` format but DeepSeek emitted `SUGGESTIONS>>` without angle brackets. (2) Markup was only stripped after stream ended, not during streaming.
- **Fix:** Broadened regex to handle variations. Added real-time stripping in `updateMessageContent()` that hides everything from first `SUGGESTIONS` marker onward during streaming.
- **File:** `extension/sidepanel.js` — `parseSuggestions()` and `updateMessageContent()`
- **Date:** 2026-03-16

### Quick save chip not working after new conversation
- **Symptom:** "Save this page" chip went through slow LLM path instead of instant `quickSavePage()` after starting a new conversation
- **Root cause:** `showWelcome()` dynamically recreates chips and re-binds click handlers (line ~2266). The re-binding was missing the `quickSavePage()` fast-path check — it sent all chips through `sendMessage()`.
- **Fix:** Added the same `if (prompt === "Save this page to my vault") { quickSavePage(); return; }` check to the `showWelcome()` re-binding.
- **File:** `extension/sidepanel.js` — `showWelcome()` function
- **Lesson:** Any fast-path logic in chip handlers MUST also be added to `showWelcome()` re-binding. This applies to future fast-path commands too.
- **Date:** 2026-03-16

---

## Extension — Background Enrichment

### Enrichment not running for cloud users (B04)
- **Symptom:** Traces saved by cloud users (no BYOK key) never got metadata enrichment
- **Root cause:** The trigger condition was `data.id && CONFIG.openrouterKey` — cloud users don't have `openrouterKey`, they use `authToken` with the server proxy. The enrichment function also called OpenRouter directly instead of routing through the proxy.
- **Fix:** Changed trigger to `data.id && (CONFIG.openrouterKey || CONFIG.authToken)`. Changed `enrichTrace()` to route through BYOK or proxy using the same logic as `streamResponse()`.
- **File:** `extension/sidepanel.js` — `enrichTrace()` and both save trigger points
- **Lesson:** Any new feature that calls an LLM must support BOTH auth paths (BYOK direct + cloud proxy).
- **Date:** 2026-03-16

### Enrichment getting SSE response instead of JSON
- **Symptom:** `[Enrich] Failed for trace #5: Unexpected token ':' ... is not valid JSON`
- **Root cause:** Server proxy hardcoded `stream: true` (line 42 of proxy.ts), ignoring client's `stream: false`. Enrichment expected a JSON response but got SSE chunks.
- **Fix:** Proxy now reads `stream` from request body and defaults to `true` only if not explicitly `false`. Added non-streaming response path that returns `res.json()` instead of piping SSE.
- **File:** `src/proxy.ts` — `handleChatProxy()` function
- **Lesson:** The proxy must respect client-sent parameters, not override them.
- **Date:** 2026-03-16

---

## Server — Database & Auth

### "no such table: magic_tokens" after deploy (B06)
- **Symptom:** Sign-in failed with "no such table: magic_tokens" after redeploying
- **Root cause:** `initSystemDb()` was gated behind `if (IS_CLOUD)` in `src/index.ts`. When `NEURALTRACE_MODE` wasn't set (or was `selfhosted`), the system database tables (users, api_keys, magic_tokens) were never created. Auth needs these tables regardless of mode.
- **Fix:** Changed to always call `initSystemDb()` without the cloud mode check.
- **File:** `src/index.ts` — startup section
- **Lesson:** Auth infrastructure must initialize in ALL modes, not just cloud.
- **Date:** 2026-03-16

---

## Deployment

### Production .env overwritten by rsync (B05)
- **Symptom:** After deploy, SMTP/Paddle/JWT/cloud mode all broken. Extension showed "SMTP not configured" error.
- **Root cause:** Ad-hoc `rsync` command didn't exclude `.env`. Local `.env` (dev credentials only) overwrote production `.env` (which had SMTP, Paddle, JWT secret, cloud mode).
- **Fix:** Created `deploy.sh` with permanent `--exclude='.env'` + automatic backup of production `.env` before every deploy. Saved deploy safety rules to auto-memory.
- **File:** `deploy.sh` (new)
- **Lesson:** NEVER use ad-hoc rsync to deploy. Always use `deploy.sh`. Always back up `.env` first. Always confirm with Abel before touching the VPS.
- **Three rules (approved by Abel):**
  1. Abel reviews and approves deploy commands before execution
  2. Back up production .env first, every time
  3. Use `deploy.sh`, never ad-hoc rsync
- **Date:** 2026-03-16

---

## Extension — Calendar & Enrichment (2026-03-21)

### Stale calendar chips showing wrong event
- **Symptom:** Searching for Harry Potter event showed calendar buttons for Mother's Day Mini Session
- **Root cause:** `pendingEventActions` was only updated when search results contained enriched events (`if (eventResults.length > 0)`). When a search returned no enriched events, the old data persisted.
- **Fix:** Always reset `pendingEventActions` on every search, regardless of whether events are found.
- **File:** `extension/sidepanel.js` — `executeTool()` search_vault handler
- **Lesson:** Module-level state used for UI rendering must be explicitly cleared on every trigger, not conditionally updated.
- **Date:** 2026-03-21

### Enrichment silently failing for all page captures
- **Symptom:** All traces saved after #18 had `metadata: null` — enrichment never completed
- **Root cause:** Three compounding issues: (1) `max_tokens: 300` was too low — LLM response truncated mid-JSON (`finish_reason: "length"`), `JSON.parse()` threw, error swallowed. (2) Large page content (ticket listings) sent untruncated to LLM. (3) Right-click "Remember this page" saved via background.js which had no enrichment call — only `quickSavePage()` and `save_trace` tool triggered enrichment.
- **Fix:** (1) Increased `max_tokens` to 800. (2) Truncate content to 2,000 chars before enrichment. (3) Added `enrichTrace()` call to side panel's `trace-saved` message listener. (4) Added error logging for failed LLM calls.
- **Files:** `extension/sidepanel.js` — `enrichTrace()`, `init()` trace-saved listener
- **Lesson:** When a feature has multiple entry points (quick save, LLM tool, right-click), ALL paths must trigger downstream processing. Also, `max_tokens` must accommodate the full expected response, not just the "typical" case.
- **Date:** 2026-03-21

### Outlook calendar URL not working for M365 users
- **Symptom:** "Add to Outlook" button redirected to Microsoft marketing page instead of calendar compose
- **Root cause:** URL used `outlook.live.com` which only works for personal Microsoft accounts. M365/work accounts use `outlook.office.com`.
- **Fix:** Changed URL to `outlook.office.com/calendar/0/action/compose` which works for both account types.
- **File:** `extension/sidepanel.js` — `generateCalendarLinks()`
- **Date:** 2026-03-21

### Enrichment fabricating start times for events without explicit times
- **Symptom:** Mother's Day Mini Session showed as 9:00 AM - 9:20 AM in calendar — no time was on the original page
- **Root cause:** Enrichment prompt said "ALWAYS extract end time" and required `HH:mm:ss` format, forcing the LLM to guess when no time existed.
- **Fix:** Updated prompt to allow `allDay: true` with date-only format (`YYYY-MM-DD`). Added "NEVER fabricate a start time" rule. Updated `generateCalendarLinks()` with all-day event support for Google, Outlook, and iCal.
- **File:** `extension/sidepanel.js` — `enrichTrace()` prompt, `generateCalendarLinks()`
- **Lesson:** LLM extraction prompts must allow "I don't know" answers for optional fields. Forcing extraction guarantees hallucination.
- **Date:** 2026-03-21

### Keyboard shortcut conflicts with Chrome incognito
- **Symptom:** `Cmd+Shift+N` / `Ctrl+Shift+N` opened Chrome incognito instead of NeuralTrace
- **Root cause:** Chrome reserves this shortcut for incognito mode on all platforms
- **Fix:** Changed to `Alt+Shift+N` (Windows/Linux) / `Option+Shift+N` (Mac)
- **Files:** `extension/manifest.json`, `extension/sidepanel.html`, `docs/features/feature-guide.md`
- **Date:** 2026-03-21

---

## Extension — Summarize Page & Save Paths (2026-03-21)

### Page extraction fails from side panel buttons but works from right-click (R21)
- **Symptom:** "Summarize Page" and "Save Page" buttons showed "Couldn't read this page. Try a different tab." on most sites (LessWrong, BBC, NPR). Right-click "Save Page" worked fine on the same pages.
- **Root cause:** The `get-page-content` handler in background.js used `chrome.scripting.executeScript` which requires `activeTab` permission. `activeTab` is granted when the user clicks the toolbar icon (opens side panel) but **revoked when the user navigates to a new page** while the side panel stays open. Right-click works because context menu clicks grant fresh `activeTab`.
- **Fix:** Replaced `chrome.scripting.executeScript` with `chrome.tabs.sendMessage` which sends a message to the content script (`content.js`) already injected on all pages via `<all_urls>` in the manifest. No `activeTab` needed.
- **Files:** `extension/background.js` — `get-page-content` handler. `extension/content.js` — upgraded to smart selector + meta tag extraction.
- **Lesson:** `chrome.scripting.executeScript` requires `activeTab` or matching `host_permissions`. Content scripts declared in the manifest with `<all_urls>` are always available. For side panel features that need page access, always prefer messaging the content script over dynamic script injection.
- **Date:** 2026-03-21

### Right-click "Save Page" fails for cloud users — no AI summary (R17)
- **Symptom:** Right-click "Save Page" always saved raw page content for cloud users, never an AI summary. BYOK users got summaries.
- **Root cause:** `summarizePage()` in background.js checked `if (!config.openrouterKey) throw new Error("No OpenRouter key")` — cloud users have a JWT but no OpenRouter key, so it always threw and fell back to raw content.
- **Fix:** Rewrote `summarizePage()` to route through the server proxy (`${config.apiBase}/api/chat/completions`) when no OpenRouter key but auth token exists. Must set `stream: false` explicitly — the proxy defaults to `true`.
- **File:** `extension/background.js` — `summarizePage()` function
- **Lesson:** Any feature that calls an LLM must support BOTH auth paths (BYOK direct + cloud proxy). This is the third time this pattern has caused a bug (B04 enrichment, B09 vision, now R17 right-click summary).
- **Date:** 2026-03-21

### Retrieval condenses structured summaries into paragraphs (R22)
- **Symptom:** User saves a detailed Summarize Page summary (with ## headers, bullet points, organized sections). Later asks for it back. The LLM condenses it into a single paragraph, losing all the structure the user saw and chose to save.
- **Root cause:** System prompt formatting rule said "Present results conversationally, NEVER dump raw trace content" and "Keep it scannable and clean — no extra formatting or bullet points within a single result." These rules applied to ALL vault results, including already-structured summaries.
- **Debugging journey:** First attempt (R22 v1) rewrote the entire formatting rules section — too broad, risked affecting all vault retrievals. Reverted. Second attempt (R22 v2) added a single EXCEPTION line: "If the saved content already has markdown headers or structured bullet points, preserve that structure instead of condensing it." This narrowly targets structured summaries without changing behavior for raw/unstructured traces.
- **Fix:** Added one line to system prompt formatting rules: `EXCEPTION: If the saved content already has markdown headers (##) or structured bullet points, preserve that structure instead of condensing it into a paragraph`
- **File:** `extension/sidepanel.js` — `SYSTEM_PROMPT` constant, formatting rules section
- **Lesson:** When modifying LLM system prompts, make the narrowest possible change. A broad rewrite can have unintended effects across all features that use the same prompt. Add exceptions rather than rewriting rules. Also: test the fix end-to-end (summarize → save → new conversation → retrieve) before marking it done.
- **Date:** 2026-03-21

---

## How to use this file

**When fixing a bug:**
1. Fix the code
2. Add an entry here with: symptom, root cause, fix, file, lesson
3. Update the changelog
4. Update the feature guide if the fix changes user-facing behavior

**When a future session encounters a similar issue:**
1. Search this file first — the fix may already be documented
2. Check the "Lesson" line — it explains how to avoid the same mistake
