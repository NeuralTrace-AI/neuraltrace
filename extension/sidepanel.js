// NeuralTrace Side Panel — Chat + Vault Integration

// ============================================================
// Config
// ============================================================
const CONFIG = {
  apiBase: "http://localhost:3000",
  authToken: "", // JWT (cloud) or ADMIN_PASSWORD (selfhosted)
  openrouterKey: "", // loaded from storage
  model: "qwen/qwen3.5-flash-02-23",
  openrouterBase: "https://openrouter.ai/api/v1",
  userEmail: "",
  userPlan: "",
  authMode: "selfhosted", // "cloud" or "selfhosted"
  serverModel: "", // model assigned by server (plan-based)
  serverLimits: {}, // usage limits from server
  selectedModel: "" // user-selected model override (persisted)
};

// Model lists per tier
const MODELS_PRO = [
  { id: "openai/gpt-5", label: "GPT 5", desc: "Most capable for ambitious work" },
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", desc: "Most efficient for everyday tasks" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "Best for research and analysis" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Fastest for quick answers" },
];
const MODELS_BYOK = [
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3.2", desc: "Budget — fast and capable" },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash", desc: "Best value for the price" },
  { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", desc: "Premium — strongest reasoning" },
  { id: "qwen/qwen3.5-flash-02-23", label: "Qwen 3.5 Flash", desc: "Current default" },
];

// ============================================================
// State
// ============================================================
let chatHistory = []; // {role, content, tool_calls?, tool_call_id?}
let isStreaming = false;
let currentPageContext = null;
let toolsUsedThisTurn = []; // tracks tools called during current response cycle
let activeConversationId = null;
const MAX_CONVERSATIONS = 50;
let pendingImages = [];  // { dataUrl, id }
let lastSearchEventMeta = null; // most recent event metadata from search — used by /add-calendar
let pendingSummarizePage = false; // flag to render "Add to vault" after summarize response
let pendingSummarizePageData = null; // { title, url, summary } — for direct vault save from Summarize Page
let imageSourceContext = null; // { title, url } — captured at paste time for silent URL attribution
const MAX_IMAGES = 3;
const VISION_MODEL = "google/gemini-2.0-flash-001";

// ============================================================
// DOM refs
// ============================================================
const $messages = document.getElementById("messages");
const $input = document.getElementById("input");
const $btnSend = document.getElementById("btn-send");
const $btnNewChat = document.getElementById("btn-new-chat");
const $btnHistory = document.getElementById("btn-history");
const $historyOverlay = document.getElementById("history-overlay");
const $historyList = document.getElementById("history-list");
const $btnCloseHistory = document.getElementById("btn-close-history");
const $btnHistoryNew = document.getElementById("btn-history-new");
const $btnGuide = document.getElementById("btn-guide");
const $guideOverlay = document.getElementById("guide-overlay");
const $btnSettings = document.getElementById("btn-settings");
const $settingsPanel = document.getElementById("settings-panel");
const $btnSaveSettings = document.getElementById("btn-save-settings");
const $inputApiKey = document.getElementById("input-apikey");
const $inputServer = document.getElementById("input-server");
const $inputToken = document.getElementById("input-token");
const $statusText = document.getElementById("status-text");
const $btnMic = document.getElementById("btn-mic");
const $pageContextBadge = document.getElementById("page-context-badge");
const $pageContextText = document.getElementById("page-context-text");
const $btnDismissContext = document.getElementById("btn-dismiss-context");
const $imagePreviewRow = document.getElementById("image-preview-row");
const $modelBadge = document.querySelector(".model-badge");
const $planBadge = document.getElementById("plan-badge");
const $modelDropdown = document.getElementById("model-dropdown");
const $btnModelSelect = document.getElementById("btn-model-select");
const $modelDropdownLabel = document.getElementById("model-dropdown-label");
const $modelDropdownPanel = document.getElementById("model-dropdown-panel");

// Auth screen DOM refs
const $authScreen = document.getElementById("auth-screen");
const $authForm = document.getElementById("auth-form");
const $authEmail = document.getElementById("auth-email");
const $btnAuthSend = document.getElementById("btn-auth-send");
const $authPending = document.getElementById("auth-pending");
const $authPendingEmail = document.getElementById("auth-pending-email");
const $btnAuthCancel = document.getElementById("btn-auth-cancel");
const $authError = document.getElementById("auth-error");
const $authErrorMsg = document.getElementById("auth-error-msg");
const $btnAuthRetry = document.getElementById("btn-auth-retry");
const $btnAuthRetryErr = document.getElementById("btn-auth-retry-err");
const $btnAuthSelfhosted = document.getElementById("btn-auth-selfhosted");

// Settings auth DOM refs
const $settingsAccount = document.getElementById("settings-account");
const $settingsEmail = document.getElementById("settings-email");
const $settingsPlan = document.getElementById("settings-plan");
const $btnSignOut = document.getElementById("btn-sign-out");
const $btnGenerateKey = document.getElementById("btn-generate-key");
const $apiKeyResult = document.getElementById("api-key-result");
const $apiKeyValue = document.getElementById("api-key-value");
const $btnCopyKey = document.getElementById("btn-copy-key");
const $settingsTokenGroup = document.getElementById("settings-token-group");
const $settingsApikeySection = document.getElementById("settings-apikey-section");
const $btnToggleAdvanced = document.getElementById("btn-toggle-advanced");
const $settingsAdvanced = document.getElementById("settings-advanced");
const $advancedChevron = document.getElementById("advanced-chevron");
const $selectMode = document.getElementById("select-mode");

// ============================================================
// System Prompt
// ============================================================
const SYSTEM_PROMPT = `You are NeuralTrace — a memory-first AI assistant living in the user's browser side panel. You are "your vault's voice."

Your job:
- Help users search, save, and manage their NeuralTrace memory vault
- Answer questions using their saved memories (traces)
- Provide context about the current page when asked
- Be conversational, concise, and helpful

You have these tools:
- search_vault: Search the user's memory vault for relevant traces
- save_trace: Save new content to the vault
- delete_trace: Delete a trace by ID
- get_page_context: Get the title, URL, and content of the user's current browser tab

Behavior rules:
1. When asked about past decisions, preferences, or saved knowledge — search the vault first
2. When the user says "save this" or "remember this" — save it to the vault
3. After saving a trace, ALWAYS confirm with a short message: "Saved to vault." (you may add the trace title or a brief note, but keep it to one line)
4. When asked "about this page" — use get_page_context, then optionally search vault for related memories
5. If the vault has no relevant results, just answer the question directly — NEVER say "I didn't find anything in your vault" or mention the vault search. The vault lookup is invisible to the user.
6. Keep responses concise — this is a side panel, not a full-page chat
7. Use markdown formatting (bold, lists, code) when helpful
8. You can answer any question. You are memory-first — always check the vault when relevant — but you are also a capable general assistant. Answer the question, then naturally offer to save if the answer seems worth remembering.

Formatting rules for vault results:
- Present results conversationally, NEVER dump raw trace content
- For each result: bold **title or summary**, then a short description paragraph
- EXCEPTION: If the saved content already has markdown headers (##) or structured bullet points, preserve that structure instead of condensing it into a paragraph
- If a trace has a source URL, show it as a clickable markdown link on its OWN line: "Source: [Page Title](url)"
- Show the saved date on its OWN separate line: "Saved: YYYY-MM-DD"
- IMPORTANT: Source and Saved MUST each be on their own line with a blank line between them. NEVER put them on the same line.
- NEVER nest blockquotes (> >) or dump the raw "content" field verbatim
- Keep it scannable and clean — no extra formatting or bullet points within a single result
- Use this EXACT format (note the blank lines separating each section):

**Roy Lee admits to lying about Cluely's $7M ARR**

Cluely CEO Roy Lee admitted on X that the annual recurring revenue figure he shared with TechCrunch was false. He issued a formal retraction.

Source: [Cluely CEO Roy Lee admits to publicly lying | TechCrunch](https://techcrunch.com/...)

Saved: 2026-03-09

Follow-up suggestions (MANDATORY):
After EVERY response that uses search_vault or list_traces results, you MUST append exactly this block at the very end:
<<SUGGESTIONS>>First suggestion||Second suggestion||Third suggestion<</SUGGESTIONS>>

This is not optional. Every vault retrieval response MUST end with this block. NEVER write suggestions as inline text instead.

Rules:
- 2-3 suggestions, each under 40 characters
- Make them specific to the results shown
- Natural next steps: dig deeper, explore related, save something new, compare
- Do NOT include for confirmations like "Saved!" or "Deleted!"
- Example: <<SUGGESTIONS>>Compare ChatGPT vs Claude||Find my AI workflows||What else do I know about LLMs?<</SUGGESTIONS>>`;

const VISION_SUPPLEMENT = `\n\nWhen you receive an image:
1. Describe what you see concisely (2-3 sentences).
2. If you notice potentially sensitive information (API keys, passwords, credit card numbers, personal data), warn: "Heads up — this image appears to contain sensitive data. Consider whether you want to save this to your vault."
3. Suggest whether the user might want to save this to their vault.
Always end with: <<SUGGESTIONS>>Save this to my vault||Search vault for related||Describe in more detail<</SUGGESTIONS>>`;

// ============================================================
// Tools for OpenRouter
// ============================================================
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_vault",
      description: "Search the NeuralTrace memory vault for relevant traces matching a query",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — keywords or phrase" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_trace",
      description: "Save new content to the NeuralTrace vault",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The memory or information to save" },
          tags: { type: "string", description: "Comma-separated tags for categorization" }
        },
        required: ["content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_trace",
      description: "Delete a trace from the vault by its ID",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "The trace ID to delete" }
        },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_traces",
      description: "List all traces in the vault (most recent first). Use this when the user asks for a summary, overview, or 'what's in my vault' — NOT search_vault, which requires a specific keyword.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max traces to return (default 20, max 50)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_page_context",
      description: "Get the title, URL, and text content of the user's current browser tab",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  }
];

// ============================================================
// Voice Input (Web Speech API)
// ============================================================
let isRecording = false;

function initVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $btnMic.classList.add("unsupported");
    return;
  }
  // API exists — button stays visible. Actual recognition created per-session in toggleVoice.
}

async function requestMicPermission() {
  // Chrome extension side panels can't show mic permission prompts.
  // Solution: check if already granted; if not, open a popup window
  // where Chrome CAN show the prompt. Once granted on any extension page,
  // the permission applies to the entire extension origin (including side panel).

  // Quick check — already granted?
  try {
    const result = await navigator.permissions.query({ name: "microphone" });
    if (result.state === "granted") return;
  } catch {
    // permissions.query may not work in all contexts — fall through to popup
  }

  // Open a small popup window to trigger Chrome's mic permission prompt
  return new Promise((resolve, reject) => {
    const listener = (msg) => {
      if (msg.type === "mic-permission-result") {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        if (msg.granted) {
          resolve();
        } else {
          reject(new Error(msg.error || "Microphone permission denied"));
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // Open as a background tab — Chrome shows its native mic prompt there.
    // Once the user clicks Allow, the tab auto-closes.
    chrome.tabs.create({
      url: chrome.runtime.getURL("mic-permission.html"),
      active: false
    });

    // Timeout after 30 seconds
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Microphone permission request timed out"));
    }, 30000);
  });
}

function stopVoice() {
  if (window._ntRecognition) {
    window._ntRecognition.stop();
  }
}

async function startVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition || isRecording) return;

  // Request microphone permission (one-time popup tab if needed)
  try {
    await requestMicPermission();
  } catch (err) {
    console.error("[NeuralTrace] Mic permission error:", err);
    setStatus("Microphone access denied — check Chrome permissions", true);
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true; // keep listening until user stops
  recognition.interimResults = true;
  recognition.lang = "en-US";
  window._ntRecognition = recognition;

  let finalTranscript = "";
  const preExistingText = $input.value;

  recognition.onstart = () => {
    isRecording = true;
    $btnMic.classList.add("recording");
    setStatus("Listening... (click mic or Cmd+Shift+M to stop)");
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interim += transcript;
      }
    }
    const separator = preExistingText && (finalTranscript || interim) ? " " : "";
    $input.value = preExistingText + separator + finalTranscript + interim;
    $input.style.height = "auto";
    $input.style.height = Math.min($input.scrollHeight, 120) + "px";
    $btnSend.disabled = !$input.value.trim();
  };

  recognition.onend = () => {
    isRecording = false;
    $btnMic.classList.remove("recording");
    window._ntRecognition = null;
    if ($input.value.trim()) {
      setStatus("Voice captured — review and send");
      $input.focus();
    } else {
      setStatus("");
    }
  };

  recognition.onerror = (event) => {
    console.error("[NeuralTrace] Speech error:", event.error);
    isRecording = false;
    $btnMic.classList.remove("recording");
    window._ntRecognition = null;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      setStatus("Microphone blocked — allow in Chrome site settings", true);
    } else if (event.error === "no-speech") {
      setStatus("No speech detected — try again", true);
    } else if (event.error !== "aborted") {
      setStatus(`Voice error: ${event.error}`, true);
    }
  };

  try {
    recognition.start();
  } catch (err) {
    console.error("[NeuralTrace] Recognition start failed:", err);
    setStatus("Voice input failed to start", true);
  }
}

// ============================================================
// Image Handling
// ============================================================
function resizeImage(dataUrl, maxSize = 1024) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        const scale = maxSize / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = dataUrl;
  });
}

async function addImage(dataUrl) {
  if (pendingImages.length >= MAX_IMAGES) {
    setStatus(`Max ${MAX_IMAGES} images per message`, true);
    return;
  }
  const resized = await resizeImage(dataUrl);
  pendingImages.push({ dataUrl: resized, id: generateId() });
  renderImagePreviews();
  $btnSend.disabled = false;
}

function removeImage(id) {
  pendingImages = pendingImages.filter(img => img.id !== id);
  renderImagePreviews();
  $btnSend.disabled = !$input.value.trim() && pendingImages.length === 0;
}

function renderImagePreviews() {
  $imagePreviewRow.innerHTML = "";
  if (pendingImages.length === 0) {
    $imagePreviewRow.classList.add("hidden");
    return;
  }
  $imagePreviewRow.classList.remove("hidden");
  for (const img of pendingImages) {
    const thumb = document.createElement("div");
    thumb.className = "image-preview-thumb";

    const imgEl = document.createElement("img");
    imgEl.src = img.dataUrl;
    imgEl.alt = "Preview";

    const removeBtn = document.createElement("button");
    removeBtn.className = "image-thumb-remove";
    removeBtn.textContent = "\u00d7";
    removeBtn.addEventListener("click", () => removeImage(img.id));

    thumb.appendChild(imgEl);
    thumb.appendChild(removeBtn);
    $imagePreviewRow.appendChild(thumb);
  }
}

function currentTurnHasImages() {
  const lastUser = [...chatHistory].reverse().find(m => m.role === "user");
  if (!lastUser || typeof lastUser.content === "string") return false;
  return Array.isArray(lastUser.content) && lastUser.content.some(p => p.type === "image_url");
}

// ============================================================
// Conversation Persistence
// ============================================================
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getConversationTitle(messages) {
  const firstUser = messages.find(m => m.role === "user");
  if (!firstUser) return "New conversation";
  let text = "";
  if (Array.isArray(firstUser.content)) {
    const textPart = firstUser.content.find(p => p.type === "text");
    text = textPart?.text || "";
  } else {
    text = firstUser.content || "";
  }
  // If first message was image-only, use the AI's response as the title
  if (!text) {
    const firstAssistant = messages.find(m => m.role === "assistant" && m.content);
    text = firstAssistant?.content?.slice(0, 60) || "[Image]";
  }
  return text.length > 60 ? text.slice(0, 60) + "..." : text;
}

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `about ${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  return new Date(timestamp).toLocaleDateString();
}

async function loadConversations() {
  const data = await chrome.storage.local.get(["conversations", "activeConversationId"]);
  return {
    conversations: data.conversations || [],
    activeId: data.activeConversationId || null
  };
}

async function saveConversation() {
  // Only save if there are user messages
  if (!chatHistory.some(m => m.role === "user")) return;

  const { conversations } = await loadConversations();

  const now = Date.now();
  const existing = conversations.findIndex(c => c.id === activeConversationId);

  // Replace full images with small thumbnails (150px, ~3-5KB) for storage
  const strippedHistory = await Promise.all(chatHistory.map(async (msg) => {
    if (Array.isArray(msg.content)) {
      const newContent = await Promise.all(msg.content.map(async (part) => {
        if (part.type === "image_url" && part.image_url?.url?.startsWith("data:")) {
          const thumb = await resizeImage(part.image_url.url, 150);
          return { type: "image_url", image_url: { url: thumb } };
        }
        return part;
      }));
      return { ...msg, content: newContent };
    }
    return msg;
  }));

  const convo = {
    id: activeConversationId,
    title: getConversationTitle(chatHistory),
    messages: strippedHistory,
    updatedAt: now,
    createdAt: existing >= 0 ? conversations[existing].createdAt : now
  };

  if (existing >= 0) {
    conversations[existing] = convo;
  } else {
    conversations.unshift(convo);
  }

  // Cap at MAX_CONVERSATIONS — remove oldest
  if (conversations.length > MAX_CONVERSATIONS) {
    conversations.splice(MAX_CONVERSATIONS);
  }

  await chrome.storage.local.set({
    conversations,
    activeConversationId: activeConversationId
  });
}

async function loadConversation(id) {
  const { conversations } = await loadConversations();
  const convo = conversations.find(c => c.id === id);
  if (!convo) return;

  activeConversationId = convo.id;
  chatHistory = convo.messages || [];
  currentPageContext = null;
  $pageContextBadge.classList.add("hidden");

  // Re-render messages
  $messages.innerHTML = "";
  for (const msg of chatHistory) {
    if (msg.role === "user" || msg.role === "assistant") {
      if (!msg.content) continue;
      if (Array.isArray(msg.content)) {
        const textPart = msg.content.find(p => p.type === "text");
        const imageParts = msg.content.filter(p => p.type === "image_url");
        const hasStripped = imageParts.some(p => p.image_url?.url === "[image-stripped]");
        let text = textPart?.text || "";
        if (hasStripped) text += (text ? "\n" : "") + "[Image was attached]";
        const liveImages = imageParts
          .map(p => p.image_url?.url)
          .filter(u => u && u !== "[image-stripped]" && u.startsWith("data:"));
        appendMessage(msg.role, text, liveImages.length > 0 ? liveImages : null);
      } else {
        appendMessage(msg.role, msg.content);
      }
    }
  }

  await chrome.storage.local.set({ activeConversationId });
  scrollToBottom();
}

async function deleteConversation(id) {
  const { conversations } = await loadConversations();
  const filtered = conversations.filter(c => c.id !== id);
  await chrome.storage.local.set({ conversations: filtered });

  // If we deleted the active conversation, start fresh
  if (id === activeConversationId) {
    startNewConversation();
  }
}

function startNewConversation() {
  activeConversationId = generateId();
  chatHistory = [];
  currentPageContext = null;
  pendingImages = [];
  pendingSummarizePage = false;
  pendingSummarizePageData = null;
  lastSearchEventMeta = null;
  renderImagePreviews();
  $messages.innerHTML = "";
  $pageContextBadge.classList.add("hidden");
  showWelcome();
  setStatus("");
  chrome.storage.local.set({ activeConversationId });
}

// ============================================================
// Chat History Overlay
// ============================================================
async function renderHistoryOverlay() {
  const { conversations } = await loadConversations();

  if (conversations.length === 0) {
    $historyList.innerHTML = '<div class="history-empty">No conversations yet.<br>Start chatting to build your history.</div>';
    return;
  }

  // Sort by most recently updated
  conversations.sort((a, b) => b.updatedAt - a.updatedAt);

  $historyList.innerHTML = conversations.map(c => `
    <div class="history-item ${c.id === activeConversationId ? 'active' : ''}" data-id="${c.id}">
      <div class="history-item-title">${escapeHtml(c.title)}</div>
      <div class="history-item-meta">
        <span class="history-item-time">${timeAgo(c.updatedAt)}</span>
        <button class="history-item-delete" data-delete-id="${c.id}" title="Delete conversation">&times;</button>
      </div>
    </div>
  `).join("");

  // Bind click handlers
  $historyList.querySelectorAll(".history-item").forEach(el => {
    el.addEventListener("click", (e) => {
      // Don't trigger if clicking delete button
      if (e.target.closest(".history-item-delete")) return;
      const id = el.dataset.id;
      loadConversation(id);
      $historyOverlay.classList.add("hidden");
    });
  });

  $historyList.querySelectorAll(".history-item-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteId;
      deleteConversation(id);
      renderHistoryOverlay(); // refresh the list
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// Init
// ============================================================
async function init() {
  // Load config from storage
  const stored = await chrome.storage.local.get([
    "openrouterKey", "apiBase", "authToken", "jwt", "userEmail", "userPlan", "authMode", "selectedModel"
  ]);
  if (stored.openrouterKey) CONFIG.openrouterKey = stored.openrouterKey;
  if (stored.apiBase) CONFIG.apiBase = stored.apiBase;
  if (stored.authMode) CONFIG.authMode = stored.authMode;
  if (stored.selectedModel) {
    CONFIG.selectedModel = stored.selectedModel;
    // For BYOK users, selectedModel overrides the default model
    if (CONFIG.openrouterKey) CONFIG.model = stored.selectedModel;
  }

  // Auth: use JWT if available, fall back to legacy authToken
  if (stored.jwt) {
    CONFIG.authToken = stored.jwt;
    CONFIG.authMode = "cloud"; // JWT presence means cloud user — protect after default flip to selfhosted
    CONFIG.userEmail = stored.userEmail || "";
    CONFIG.userPlan = stored.userPlan || "free";
  } else if (stored.authToken) {
    CONFIG.authToken = stored.authToken;
    CONFIG.authMode = "selfhosted";
  }

  // Set plan badge from persisted state immediately (prevents flash)
  updatePlanBadge();
  updateModelDropdown();
  renderModeSelector();

  // Populate settings fields
  $inputApiKey.value = CONFIG.openrouterKey;
  $inputServer.value = CONFIG.apiBase;
  if (CONFIG.authMode === "selfhosted") {
    $inputToken.value = CONFIG.authToken;
  }

  // Init voice input
  initVoiceInput();

  // Init upgrade prompt handlers
  initUpgradePrompt();

  // Check auth state
  const isAuthed = await checkAuth();
  if (!isAuthed) {
    showAuthScreen();
    return;
  }

  // Show main app
  showMainApp();
}

async function checkAuth() {
  // Selfhosted mode: no token required to enter main app
  // (user configures server + token in settings after landing)
  if (CONFIG.authMode === "selfhosted" && !CONFIG.authToken) {
    return true;
  }
  if (!CONFIG.authToken) return false;

  // Quick validation: try to hit the API
  try {
    const res = await fetch(`${CONFIG.apiBase}/api/traces?limit=1`, {
      headers: { "Authorization": `Bearer ${CONFIG.authToken}` }
    });
    if (res.status === 401) {
      // JWT expired or invalid — clear it
      console.log("[Auth] Token expired/invalid, clearing");
      await clearAuth();
      return false;
    }
    return res.ok;
  } catch (err) {
    // Network error — assume auth is OK (offline mode)
    console.log("[Auth] Network error during check, assuming valid:", err.message);
    return !!CONFIG.authToken;
  }
}

function showAuthScreen() {
  // Reset to clean initial state — only show the email form
  stopAuthPolling();
  $authForm.classList.remove("hidden");
  $authPending.classList.add("hidden");
  $authError.classList.add("hidden");

  $authScreen.classList.remove("hidden");
  document.getElementById("header").style.display = "none";
  document.getElementById("messages").style.display = "none";
  document.getElementById("input-area").style.display = "none";
  updateSettingsAuthUI();
}

function hideAuthScreen() {
  $authScreen.classList.add("hidden");
  document.getElementById("header").style.display = "";
  document.getElementById("messages").style.display = "";
  document.getElementById("input-area").style.display = "";
}

async function showMainApp() {
  // Fully reset auth UI (including any stuck pending/error states)
  stopAuthPolling();
  $authForm.classList.remove("hidden");
  $authPending.classList.add("hidden");
  $authError.classList.add("hidden");
  $authEmail.value = "";

  hideAuthScreen();
  updateSettingsAuthUI();

  // Fetch user status (plan, model) from server if authenticated
  if (CONFIG.authToken && CONFIG.authMode === "cloud") {
    fetchUserStatus();
  }

  // Selfhosted new install: nudge user to configure server if no token set
  if (CONFIG.authMode === "selfhosted" && !CONFIG.authToken) {
    setStatus("Connect your server in Settings", true);
  }

  // Restore active conversation or start new
  const { conversations, activeId } = await loadConversations();
  if (activeId && conversations.find(c => c.id === activeId)) {
    await loadConversation(activeId);
  } else {
    activeConversationId = generateId();
    await chrome.storage.local.set({ activeConversationId });
  }

  // Listen for trace events from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "trace-saving") {
      showNotification(`Saving "${msg.title}"...`, "info");
    }
    if (msg.type === "trace-saved") {
      showNotification(`Saved to vault.`, "success");
      // Background script doesn't enrich — trigger it from here
      if (msg.trace.id && msg.trace.content && (CONFIG.openrouterKey || CONFIG.authToken)) {
        setTimeout(() => enrichTrace(msg.trace.id, msg.trace.content), 500);
      }
    }
  });

  // Clear stale page context when user switches tabs
  chrome.tabs.onActivated.addListener(() => {
    currentPageContext = null;
  });

  // Show onboarding for returning users who haven't completed it
  // (For first-time sign-in, onboarding is triggered from completeSignIn instead)
  setTimeout(() => maybeShowOnboarding(), 2000);
}

function updateSettingsAuthUI() {
  if (CONFIG.authMode === "cloud" && CONFIG.userEmail) {
    // Cloud mode — show account info, hide token input
    $settingsAccount.classList.remove("hidden");
    $settingsApikeySection.classList.remove("hidden");
    $settingsTokenGroup.classList.add("hidden");
    $settingsEmail.textContent = CONFIG.userEmail;
    $settingsPlan.textContent = CONFIG.userPlan || "free";
    // Show/hide upgrade button based on plan
    const $btnUpgradePro = document.getElementById("btn-upgrade-pro");
    if (CONFIG.userPlan === "pro") {
      $btnUpgradePro.classList.add("hidden");
    } else {
      $btnUpgradePro.classList.remove("hidden");
    }
  } else {
    // Self-hosted — hide account info, show token input, auto-expand Advanced
    $settingsAccount.classList.add("hidden");
    $settingsApikeySection.classList.add("hidden");
    $settingsTokenGroup.classList.remove("hidden");
    $inputToken.value = CONFIG.authToken;
    // Auto-expand Advanced for self-hosted (they need Server URL + Token)
    $settingsAdvanced.classList.remove("hidden");
    $advancedChevron.classList.add("expanded");
  }
}

function renderModeSelector() {
  if ($selectMode) {
    $selectMode.value = CONFIG.authMode;
  }
}

// ─── Model Dropdown ───
function updateModelDropdown() {
  const isBYOK = !!CONFIG.openrouterKey;
  const isPro = CONFIG.userPlan === "pro";
  const isFree = !isBYOK && !isPro;

  // Hide for free cloud users
  if (isFree && CONFIG.authMode === "cloud") {
    $modelDropdown.classList.add("hidden");
    return;
  }

  $modelDropdown.classList.remove("hidden");

  const models = isBYOK ? MODELS_BYOK : MODELS_PRO;
  const currentModel = isBYOK
    ? CONFIG.model
    : (CONFIG.selectedModel || CONFIG.serverModel || models[0]?.id);

  // Update label
  const activeModel = models.find(m => m.id === currentModel);
  $modelDropdownLabel.textContent = activeModel?.label || currentModel.split("/").pop() || "AI";

  // Render options
  let html = models.map(m => `
    <div class="model-option ${m.id === currentModel ? "active" : ""}" data-model="${m.id}">
      <div>
        <div class="model-option-name">${m.label}</div>
        <div class="model-option-desc">${m.desc}</div>
      </div>
      <span class="model-check">\u2713</span>
    </div>
  `).join("");

  // BYOK gets custom model input
  if (isBYOK) {
    const isCustom = !models.find(m => m.id === currentModel);
    html += `
      <div class="model-option ${isCustom ? "active" : ""}" id="model-custom-option">
        <div>
          <div class="model-option-name">Custom model...</div>
          <div class="model-option-desc">Any OpenRouter model ID</div>
        </div>
        <span class="model-check">\u2713</span>
      </div>
      <input type="text" class="model-custom-input hidden" id="model-custom-input"
        placeholder="e.g. meta-llama/llama-3.3-70b-instruct:free"
        value="${isCustom ? currentModel : ""}">
    `;
  }

  $modelDropdownPanel.innerHTML = html;

  // Bind option clicks
  $modelDropdownPanel.querySelectorAll(".model-option:not(#model-custom-option)").forEach(el => {
    el.addEventListener("click", () => selectModel(el.dataset.model));
  });

  // Custom model option
  const customOption = document.getElementById("model-custom-option");
  const customInput = document.getElementById("model-custom-input");
  if (customOption && customInput) {
    customOption.addEventListener("click", () => {
      customInput.classList.toggle("hidden");
      if (!customInput.classList.contains("hidden")) customInput.focus();
    });
    customInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && customInput.value.trim()) {
        selectModel(customInput.value.trim());
      }
    });
  }
}

function selectModel(modelId) {
  const isBYOK = !!CONFIG.openrouterKey;
  if (isBYOK) {
    CONFIG.model = modelId;
    chrome.storage.local.set({ selectedModel: modelId });
  } else {
    CONFIG.selectedModel = modelId;
    chrome.storage.local.set({ selectedModel: modelId });
  }
  $modelDropdownPanel.classList.add("hidden");
  updateModelDropdown();
}

// Toggle dropdown
$btnModelSelect.addEventListener("click", (e) => {
  e.stopPropagation();
  $modelDropdownPanel.classList.toggle("hidden");
});

// Close dropdown on outside click
document.addEventListener("click", (e) => {
  if (!$modelDropdown.contains(e.target)) {
    $modelDropdownPanel.classList.add("hidden");
  }
});

// ─── Sign In Flow ───

let authPollInterval = null;

async function startSignIn(email) {
  // Show pending state
  $authForm.classList.add("hidden");
  $authError.classList.add("hidden");
  $authPending.classList.remove("hidden");
  $authPendingEmail.textContent = email;

  try {
    // Request magic link
    const res = await fetch(`${CONFIG.apiBase}/api/auth/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || "Failed to send magic link");
    }

    // Start polling for sign-in completion
    startAuthPolling(email);
  } catch (err) {
    showAuthError(err.message);
  }
}

function startAuthPolling(email) {
  let attempts = 0;
  const maxAttempts = 100; // 5 minutes at 3-second intervals

  authPollInterval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      stopAuthPolling();
      showAuthError("Magic link expired. Please try again.");
      return;
    }

    try {
      const res = await fetch(`${CONFIG.apiBase}/api/auth/status?email=${encodeURIComponent(email)}`);
      const data = await res.json();

      if (data.authenticated) {
        stopAuthPolling();
        await completeSignIn(data.jwt, data.user);
      }
    } catch (err) {
      // Network error — keep polling
      console.log("[Auth] Poll error:", err.message);
    }
  }, 3000);
}

function stopAuthPolling() {
  if (authPollInterval) {
    clearInterval(authPollInterval);
    authPollInterval = null;
  }
}

async function completeSignIn(jwt, user) {
  CONFIG.authToken = jwt;
  CONFIG.userEmail = user.email;
  CONFIG.userPlan = user.plan;
  CONFIG.authMode = "cloud";

  await chrome.storage.local.set({
    jwt,
    userEmail: user.email,
    userPlan: user.plan,
    authMode: "cloud"
  });

  console.log("[Auth] Signed in as", user.email);
  await showMainApp();
}

async function fetchUserStatus() {
  try {
    const res = await fetch(`${CONFIG.apiBase}/api/user/status`, {
      headers: { "Authorization": `Bearer ${CONFIG.authToken}` }
    });
    if (!res.ok) {
      console.warn("[status] Failed to fetch user status:", res.status);
      return;
    }
    const data = await res.json();
    CONFIG.userPlan = data.plan || "free";
    CONFIG.serverModel = data.model || "";
    CONFIG.serverLimits = data.limits || {};

    // Consume newToken if server issued a fresh JWT (e.g. after plan change)
    if (data.newToken) {
      CONFIG.authToken = data.newToken;
      await chrome.storage.local.set({ jwt: data.newToken });
      console.log("[status] newToken received, JWT updated");
    }

    // Update model badge to show server-assigned model
    if (!CONFIG.openrouterKey && CONFIG.serverModel) {
      const shortName = CONFIG.serverModel.split("/").pop() || CONFIG.serverModel;
      $modelBadge.textContent = shortName;
    }

    // Update plan badge, model dropdown, and settings
    updatePlanBadge();
    updateModelDropdown();

    // Persist plan
    await chrome.storage.local.set({ userPlan: data.plan });
    console.log(`[status] plan=${data.plan} model=${data.model} newToken=${data.newToken ? "received" : "absent"}`);
  } catch (err) {
    console.warn("[status] Error fetching user status:", err.message);
  }
}

function updatePlanBadge() {
  const plan = (CONFIG.userPlan || "free").toLowerCase();
  const isPro = plan === "pro";

  // Update footer plan badge
  if (CONFIG.authMode === "selfhosted") {
    $planBadge.classList.add("hidden");
  } else {
    $planBadge.classList.remove("hidden");
    $planBadge.textContent = isPro ? "PRO" : "FREE";
    $planBadge.classList.toggle("pro", isPro);
  }

  // Update settings panel plan badge
  if ($settingsPlan) {
    $settingsPlan.textContent = isPro ? "PRO" : "free";
    $settingsPlan.classList.toggle("pro", isPro);
  }

  // Update BYOK indicator in settings
  const byokEl = document.getElementById("settings-byok-indicator");
  if (byokEl) {
    byokEl.textContent = CONFIG.openrouterKey ? "Using your own key" : "Using NeuralTrace AI";
  }

  console.log(`[plan] badge updated to ${isPro ? "PRO" : "FREE"}`);
}

async function signOut() {
  await clearAuth();
  chatHistory = [];
  showAuthScreen();
  // Reset auth form
  $authForm.classList.remove("hidden");
  $authPending.classList.add("hidden");
  $authError.classList.add("hidden");
  $authEmail.value = "";
}

async function clearAuth() {
  CONFIG.authToken = "";
  CONFIG.userEmail = "";
  CONFIG.userPlan = "";
  await chrome.storage.local.remove(["jwt", "userEmail", "userPlan"]);
}

function showAuthError(message) {
  $authPending.classList.add("hidden");
  $authForm.classList.add("hidden");
  $authError.classList.remove("hidden");
  $authErrorMsg.textContent = message;
}

// ─── API Key Generation ───

async function generateApiKey() {
  try {
    const res = await fetch(`${CONFIG.apiBase}/api/keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CONFIG.authToken}`
      },
      body: JSON.stringify({ name: "extension" })
    });

    if (!res.ok) throw new Error("Failed to generate key");
    const data = await res.json();

    $apiKeyValue.textContent = data.key;
    $apiKeyResult.classList.remove("hidden");
  } catch (err) {
    showNotification("Failed to generate API key: " + err.message);
  }
}

// ─── Rate Limit & Upgrade Prompt ───

const RATE_LIMIT_MESSAGES = {
  trace_limit: "You've reached the trace storage limit on the Free plan.",
  search_limit: "You've reached the daily search limit on the Free plan.",
  api_key_limit: "You've reached the API key limit on the Free plan."
};

function showUpgradePrompt(errorData) {
  const $prompt = document.getElementById("upgrade-prompt");
  const $message = document.getElementById("upgrade-message");
  const $counts = document.getElementById("upgrade-counts");

  const msg = RATE_LIMIT_MESSAGES[errorData.code] || `Limit reached: ${errorData.error}`;
  $message.textContent = msg;

  if (errorData.current != null && errorData.limit != null) {
    $counts.textContent = `${errorData.current} / ${errorData.limit} used`;
  } else {
    $counts.textContent = "";
  }

  $prompt.classList.remove("hidden");
  console.log(`[rate-limit] code=${errorData.code} current=${errorData.current} limit=${errorData.limit}`);
}

function initUpgradePrompt() {
  const UPGRADE_URL = "https://neuraltrace.ai/upgrade";
  document.getElementById("btn-upgrade").addEventListener("click", () => {
    const url = CONFIG.authToken
      ? `${UPGRADE_URL}?token=${encodeURIComponent(CONFIG.authToken)}`
      : UPGRADE_URL;
    chrome.tabs.create({ url });
    // Start polling for plan change after user opens upgrade tab
    pollForPlanUpdate();
  });
  document.getElementById("btn-upgrade-dismiss").addEventListener("click", () => {
    document.getElementById("upgrade-prompt").classList.add("hidden");
  });
}

function isRateLimitCode(code) {
  return code === "trace_limit" || code === "search_limit" || code === "api_key_limit";
}

// ─── Plan Upgrade Polling ───

let pollingActive = false;

async function pollForPlanUpdate() {
  if (pollingActive) {
    console.log("[plan-poll] already active, skipping");
    return;
  }

  pollingActive = true;
  console.log("[plan-poll] started");

  const previousPlan = CONFIG.userPlan;
  let tick = 0;
  const maxTicks = 60; // 5 minutes at 5s intervals

  const poll = async () => {
    if (!pollingActive) return;

    tick++;
    if (tick > maxTicks) {
      pollingActive = false;
      console.log("[plan-poll] timeout after 5m");
      return;
    }

    try {
      const res = await fetch(`${CONFIG.apiBase}/api/user/status`, {
        headers: { "Authorization": `Bearer ${CONFIG.authToken}` }
      });
      if (!res.ok) {
        console.warn(`[plan-poll] tick=${tick} status=${res.status}`);
        setTimeout(poll, 5000);
        return;
      }
      const data = await res.json();
      const currentPlan = data.plan || "free";
      console.log(`[plan-poll] tick=${tick} plan=${currentPlan}`);

      if (currentPlan !== previousPlan) {
        // Plan changed!
        console.log(`[plan-poll] plan changed from ${previousPlan} to ${currentPlan}`);

        // Update CONFIG
        CONFIG.userPlan = currentPlan;
        CONFIG.serverModel = data.model || "";
        CONFIG.serverLimits = data.limits || {};

        // Consume newToken if present (same logic as fetchUserStatus T01)
        if (data.newToken) {
          CONFIG.authToken = data.newToken;
          await chrome.storage.local.set({ jwt: data.newToken });
          console.log("[plan-poll] newToken received, JWT updated");
        }

        // Update UI
        updatePlanBadge();

        // Update model badge
        if (!CONFIG.openrouterKey && CONFIG.serverModel) {
          const shortName = CONFIG.serverModel.split("/").pop() || CONFIG.serverModel;
          $modelBadge.textContent = shortName;
        }

        // Persist plan
        await chrome.storage.local.set({ userPlan: currentPlan });

        // Show success notification
        showNotification("🎉 Welcome to Pro! You now have unlimited access.", "success");

        // Hide any visible upgrade prompt
        const $prompt = document.getElementById("upgrade-prompt");
        if ($prompt) $prompt.classList.add("hidden");

        // Stop polling
        pollingActive = false;
        console.log("[plan-poll] stopped");
        return;
      }

      // No change yet — keep polling
      setTimeout(poll, 5000);
    } catch (err) {
      console.warn(`[plan-poll] tick=${tick} error=${err.message}`);
      setTimeout(poll, 5000);
    }
  };

  // Start first tick after 5s
  setTimeout(poll, 5000);
}

// ─── 401 Handler ───

async function authedFetch(url, options = {}) {
  const headers = { ...options.headers, "Authorization": `Bearer ${CONFIG.authToken}` };
  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && CONFIG.authMode === "cloud") {
    console.log("[Auth] 401 received, signing out");
    await signOut();
    throw new Error("Session expired. Please sign in again.");
  }

  // Surface rate limit errors as upgrade prompt (don't sign out)
  if ((res.status === 403 || res.status === 429) && CONFIG.authMode === "cloud") {
    try {
      const cloned = res.clone();
      const errorData = await cloned.json();
      if (errorData.code && isRateLimitCode(errorData.code)) {
        showUpgradePrompt(errorData);
      }
    } catch (_) {
      // Response body wasn't JSON — ignore
    }
  }

  return res;
}

// ─── Onboarding ───

const ONBOARDING_STEPS = [
  { target: "#input", text: "Ask your vault anything, search memories, get answers, or just chat.", position: "above" },
  { target: "#btn-mic", text: "Use voice input to save or search hands-free.", position: "above" },
  { target: "#btn-settings", text: "Manage your account, generate API keys for MCP connections.", position: "below" },
  { target: "#btn-guide", text: "Need help? Tap here for a quick guide to everything you can do.", position: "below" }
];

let onboardingStep = 0;

async function maybeShowOnboarding() {
  const { onboardingComplete } = await chrome.storage.local.get("onboardingComplete");
  if (onboardingComplete) return;

  // Don't show onboarding if auth screen is still visible
  if (!$authScreen.classList.contains("hidden")) {
    console.log("[Onboarding] Deferred — auth screen still visible");
    return;
  }

  // Don't show if main app elements aren't visible yet
  const inputArea = document.getElementById("input-area");
  if (!inputArea || inputArea.style.display === "none") {
    console.log("[Onboarding] Deferred — main app not visible");
    return;
  }

  startOnboarding();
}

function startOnboarding() {
  onboardingStep = 0;
  showOnboardingStep();
}

function showOnboardingStep() {
  const $overlay = document.getElementById("onboarding-overlay");
  const $text = document.getElementById("onboarding-text");
  const $step = document.getElementById("onboarding-step");
  const $tooltip = document.getElementById("onboarding-tooltip");

  // Completion check FIRST — always allow cleanup
  if (onboardingStep >= ONBOARDING_STEPS.length) {
    // Done
    $overlay.classList.add("hidden");
    $tooltip.style.display = "none";
    document.querySelectorAll(".onboarding-highlight").forEach(el => el.classList.remove("onboarding-highlight"));
    chrome.storage.local.set({ onboardingComplete: true });
    console.log("[Onboarding] Complete");
    return;
  }

  // Bail if auth screen reappeared during tour
  if (!$authScreen.classList.contains("hidden")) {
    $overlay.classList.add("hidden");
    $tooltip.style.display = "none";
    document.querySelectorAll(".onboarding-highlight").forEach(el => el.classList.remove("onboarding-highlight"));
    console.log("[Onboarding] Aborted — auth screen visible");
    return;
  }

  const step = ONBOARDING_STEPS[onboardingStep];
  const targetEl = document.querySelector(step.target);

  // Remove previous highlight
  document.querySelectorAll(".onboarding-highlight").forEach(el => el.classList.remove("onboarding-highlight"));

  if (targetEl) {
    targetEl.classList.add("onboarding-highlight");
    const rect = targetEl.getBoundingClientRect();

    // Position tooltip
    if (step.position === "above") {
      $tooltip.style.bottom = (window.innerHeight - rect.top + 12) + "px";
      $tooltip.style.top = "auto";
      $tooltip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 280)) + "px";
    } else {
      $tooltip.style.top = (rect.bottom + 12) + "px";
      $tooltip.style.bottom = "auto";
      $tooltip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 280)) + "px";
    }
  }

  $text.textContent = step.text;
  $step.textContent = ""; // step counter removed — Skip + Next is enough
  $tooltip.style.display = "";
  $overlay.classList.remove("hidden");

  // Update button text for last step
  const $btn = document.getElementById("btn-onboarding-next");
  $btn.textContent = onboardingStep === ONBOARDING_STEPS.length - 1 ? "Got it!" : "Next";
}

document.getElementById("btn-onboarding-next")?.addEventListener("click", () => {
  onboardingStep++;
  console.log(`[Onboarding] Next clicked, now step ${onboardingStep} of ${ONBOARDING_STEPS.length}`);
  showOnboardingStep();
});

// Skip tour entirely
document.getElementById("btn-onboarding-skip")?.addEventListener("click", () => {
  dismissOnboarding();
});

// Clicking the backdrop also dismisses
document.getElementById("onboarding-backdrop")?.addEventListener("click", () => {
  dismissOnboarding();
});

function dismissOnboarding() {
  const $overlay = document.getElementById("onboarding-overlay");
  const $tooltip = document.getElementById("onboarding-tooltip");
  $overlay.classList.add("hidden");
  $tooltip.style.display = "none";
  document.querySelectorAll(".onboarding-highlight").forEach(el => el.classList.remove("onboarding-highlight"));
  chrome.storage.local.set({ onboardingComplete: true });
  console.log("[Onboarding] Skipped by user");
}

// ============================================================
// Event Listeners
// ============================================================
$input.addEventListener("input", () => {
  $btnSend.disabled = (!$input.value.trim() && pendingImages.length === 0) || isStreaming;
  // Auto-resize
  $input.style.height = "auto";
  $input.style.height = Math.min($input.scrollHeight, 120) + "px";
});

$input.addEventListener("paste", async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (!blob) break;
      const reader = new FileReader();
      reader.onload = async () => {
        await addImage(reader.result);
      };
      reader.readAsDataURL(blob);
      break; // one image per paste event
    }
  }
  // Text paste falls through normally
});

$input.addEventListener("keydown", (e) => {
  // Let slash menu handler take over when menu is open
  if (!document.getElementById("slash-menu")?.classList.contains("hidden")) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (($input.value.trim() || pendingImages.length > 0) && !isStreaming) sendMessage();
  }
});

$btnSend.addEventListener("click", () => {
  if (($input.value.trim() || pendingImages.length > 0) && !isStreaming) sendMessage();
});

// Mic button: click-to-toggle + press-and-hold
let micHoldTimer = null;
let micIsHold = false;

$btnMic.addEventListener("mousedown", () => {
  micIsHold = false;
  micHoldTimer = setTimeout(() => {
    // Held for 300ms — press-and-hold mode
    micIsHold = true;
    if (!isRecording) startVoice();
  }, 300);
});

$btnMic.addEventListener("mouseup", () => {
  clearTimeout(micHoldTimer);
  if (micIsHold) {
    // Was holding — release stops recording
    stopVoice();
    micIsHold = false;
  } else {
    // Quick click — toggle mode
    if (isRecording) {
      stopVoice();
    } else {
      startVoice();
    }
  }
});

$btnMic.addEventListener("mouseleave", () => {
  // If user drags away while holding, stop recording
  clearTimeout(micHoldTimer);
  if (micIsHold && isRecording) {
    stopVoice();
    micIsHold = false;
  }
});

// Keyboard shortcut: Cmd+Shift+M (Mac) / Ctrl+Shift+M (Windows) — toggle
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "m") {
    e.preventDefault();
    if (isRecording) {
      stopVoice();
    } else {
      startVoice();
    }
  }
});

$btnNewChat.addEventListener("click", () => {
  startNewConversation();
});

$btnHistory.addEventListener("click", async () => {
  await renderHistoryOverlay();
  $historyOverlay.classList.remove("hidden");
});

$btnCloseHistory.addEventListener("click", () => {
  $historyOverlay.classList.add("hidden");
});

$btnGuide.addEventListener("click", () => {
  $guideOverlay.classList.remove("hidden");
});

$guideOverlay.addEventListener("click", () => {
  $guideOverlay.classList.add("hidden");
});

$btnHistoryNew.addEventListener("click", () => {
  startNewConversation();
  $historyOverlay.classList.add("hidden");
});

$btnSettings.addEventListener("click", () => {
  $settingsPanel.classList.toggle("hidden");
  // Always collapse Advanced when opening settings (unless self-hosted)
  if (!$settingsPanel.classList.contains("hidden") && CONFIG.authMode !== "selfhosted") {
    $settingsAdvanced.classList.add("hidden");
    $advancedChevron.classList.remove("expanded");
  }
  // Sync mode selector to current state when opening settings
  if (!$settingsPanel.classList.contains("hidden")) {
    renderModeSelector();
  }
});

// Close settings when clicking outside
document.addEventListener("click", (e) => {
  if (!$settingsPanel.classList.contains("hidden") &&
      !$settingsPanel.contains(e.target) &&
      !$btnSettings.contains(e.target)) {
    $settingsPanel.classList.add("hidden");
  }
});

$btnToggleAdvanced.addEventListener("click", () => {
  $settingsAdvanced.classList.toggle("hidden");
  $advancedChevron.classList.toggle("expanded");
});

$btnSaveSettings.addEventListener("click", async () => {
  CONFIG.openrouterKey = $inputApiKey.value.trim();
  CONFIG.apiBase = $inputServer.value.trim() || "http://localhost:3000";

  const storageUpdate = {
    openrouterKey: CONFIG.openrouterKey,
    apiBase: CONFIG.apiBase
  };

  // Only update authToken for self-hosted mode
  if (CONFIG.authMode === "selfhosted") {
    CONFIG.authToken = $inputToken.value.trim() || "";
    storageUpdate.authToken = CONFIG.authToken;
  }

  await chrome.storage.local.set(storageUpdate);

  $settingsPanel.classList.add("hidden");
  const canChat = CONFIG.openrouterKey || CONFIG.authToken;
  setStatus(canChat ? "Settings saved" : "Sign in or set API key to chat", !canChat);

  // If BYOK key was cleared but user has auth, re-fetch server model
  if (!CONFIG.openrouterKey && CONFIG.authToken && CONFIG.authMode === "cloud") {
    fetchUserStatus();
  }

  // Update model dropdown after settings change (BYOK key may have changed)
  updateModelDropdown();
});

// Mode switcher
$selectMode.addEventListener("change", async (e) => {
  const newMode = e.target.value;
  CONFIG.authMode = newMode;
  await chrome.storage.local.set({ authMode: newMode });

  if (newMode === "cloud") {
    CONFIG.apiBase = "https://neuraltrace.ai";
    $inputServer.value = CONFIG.apiBase;
    await chrome.storage.local.set({ apiBase: CONFIG.apiBase });
  } else {
    CONFIG.apiBase = "http://localhost:3000";
    $inputServer.value = CONFIG.apiBase;
    await chrome.storage.local.set({ apiBase: CONFIG.apiBase });
  }

  updateSettingsAuthUI();
  updatePlanBadge();
  updateModelDropdown();
});

// Auth event listeners
$btnAuthSend.addEventListener("click", () => {
  const email = $authEmail.value.trim();
  if (email && email.includes("@")) startSignIn(email);
});

$authEmail.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const email = $authEmail.value.trim();
    if (email && email.includes("@")) startSignIn(email);
  }
});

$btnAuthCancel.addEventListener("click", () => {
  stopAuthPolling();
  $authPending.classList.add("hidden");
  $authForm.classList.remove("hidden");
});

$btnAuthRetry.addEventListener("click", () => {
  stopAuthPolling();
  $authPending.classList.add("hidden");
  $authForm.classList.remove("hidden");
});

$btnAuthRetryErr?.addEventListener("click", () => {
  $authError.classList.add("hidden");
  $authForm.classList.remove("hidden");
});

$btnAuthSelfhosted.addEventListener("click", () => {
  CONFIG.authMode = "selfhosted";
  chrome.storage.local.set({ authMode: "selfhosted" });
  hideAuthScreen();
  $settingsPanel.classList.remove("hidden");
  updateSettingsAuthUI();
  setStatus("Enter your server URL and auth token in settings", true);
});

$btnSignOut.addEventListener("click", async () => {
  $settingsPanel.classList.add("hidden");
  await signOut();
});

// Upgrade to Pro button in settings
document.getElementById("btn-upgrade-pro").addEventListener("click", () => {
  const UPGRADE_URL = "https://neuraltrace.ai/upgrade";
  const url = CONFIG.authToken
    ? `${UPGRADE_URL}?token=${encodeURIComponent(CONFIG.authToken)}`
    : UPGRADE_URL;
  chrome.tabs.create({ url });
  pollForPlanUpdate();
});

$btnGenerateKey.addEventListener("click", generateApiKey);

$btnCopyKey.addEventListener("click", () => {
  navigator.clipboard.writeText($apiKeyValue.textContent);
  $btnCopyKey.textContent = "Copied!";
  setTimeout(() => { $btnCopyKey.textContent = "Copy"; }, 2000);
});

$btnDismissContext.addEventListener("click", () => {
  currentPageContext = null;
  $pageContextBadge.classList.add("hidden");
});

// Quick action buttons (persistent, above input)
document.getElementById("qa-save").addEventListener("click", () => quickSavePage());
document.getElementById("qa-summarize").addEventListener("click", async () => {
  if (isStreaming) return;
  setStatus("Reading page...");
  chrome.runtime.sendMessage({ type: "get-page-content" }, async (response) => {
    setStatus("");
    if (!response || response.unsupported || !response.text) {
      appendMessage("assistant", response?.unsupported
        ? "This page type isn't supported yet (browser internal page)."
        : "Couldn't read this page. Try a different tab.");
      return;
    }
    const excerpt = response.text.slice(0, 10000);
    const fullPrompt = `Give me a detailed summary of this page. Organize the summary with clear markdown headers (##) and bullet points.\n\nPage: ${response.title}\nURL: ${response.url}\n\nContent:\n${excerpt}`;

    // Show clean user message but send full prompt to LLM
    const welcome = $messages.querySelector(".welcome");
    if (welcome) welcome.remove();
    const chips = $messages.querySelector(".suggestion-chips");
    if (chips) chips.remove();

    appendMessage("user", `Summarize this page: ${response.title}`);
    chatHistory.push({ role: "user", content: fullPrompt });
    saveConversation();

    pendingSummarizePageData = { title: response.title, url: response.url };
    pendingSummarizePage = true;
    toolsUsedThisTurn = [];
    await streamResponse();
  });
});
document.getElementById("qa-recent").addEventListener("click", () => {
  $input.value = "Show my recent traces";
  $input.dispatchEvent(new Event("input"));
  sendMessage();
});

// Quick action chips
document.querySelectorAll(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const prompt = chip.dataset.prompt;

    // Fast-path: "Save this page" chip bypasses LLM for instant save
    if (prompt === "Save this page to my vault") {
      quickSavePage();
      return;
    }

    $input.value = prompt;
    $input.dispatchEvent(new Event("input"));
    sendMessage();
  });
});

// Direct page save — no LLM round-trips, sub-second
async function quickSavePage() {
  if (!CONFIG.authToken) {
    setStatus("Please sign in first", true);
    return;
  }

  // Clear welcome screen
  const welcome = $messages.querySelector(".welcome");
  if (welcome) welcome.remove();

  // Show user message
  appendMessage("user", "Save this page to my vault");

  // Extract page content
  setStatus("Saving page...");
  const pageData = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "get-page-content" }, resolve);
  });

  if (!pageData || pageData.unsupported || !pageData.title) {
    appendMessage("assistant", pageData?.unsupported
      ? "This page type isn't supported for saving."
      : "Couldn't access this page's content. Try refreshing the page.");
    setStatus("");
    return;
  }

  // Build trace content: title + URL + excerpt
  const excerpt = pageData.text?.slice(0, 3000) || "";
  const content = `${pageData.title}\n${pageData.url}\n\n${excerpt}`;
  const tags = pageData.title.split(/[\s\-|:,]+/).filter(w => w.length > 3).slice(0, 5).join(", ").toLowerCase();

  // Save directly to vault
  try {
    const res = await authedFetch(`${CONFIG.apiBase}/api/trace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, tags })
    });

    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        try {
          const errorData = await res.json();
          if (errorData.code && isRateLimitCode(errorData.code)) {
            appendMessage("assistant", `Rate limit reached: ${errorData.current}/${errorData.limit} saves used. Upgrade to Pro for unlimited access.`);
            setStatus("");
            return;
          }
        } catch (_) {}
      }
      appendMessage("assistant", `Save failed (${res.status}). Please try again.`);
      setStatus("");
      return;
    }

    const data = await res.json();
    appendMessage("assistant", `**Saved to vault.** ${pageData.title}`);
    setStatus("");

    // Add to chat history so conversation context is preserved
    chatHistory.push({ role: "user", content: "Save this page to my vault" });
    chatHistory.push({ role: "assistant", content: `Saved to vault. ${pageData.title} (trace #${data.id})` });
    saveConversation();

    // Background enrichment — classify and extract metadata silently
    if (data.id && (CONFIG.openrouterKey || CONFIG.authToken)) {
      setTimeout(() => enrichTrace(data.id, content), 500);
    }
  } catch (err) {
    appendMessage("assistant", `Error: ${err.message}`);
    setStatus("");
  }
}

// ============================================================
// Background Trace Enrichment
// ============================================================
async function enrichTrace(traceId, content) {
  try {
    // Truncate content for enrichment — first 2000 chars has the key metadata
    const truncated = content.length > 2000 ? content.substring(0, 2000) + "\n[content truncated]" : content;

    const enrichPrompt = [
      { role: "system", content: `You are a metadata extractor. Classify the saved content and extract structured metadata. Respond ONLY with valid JSON, no markdown fences.

Output schema:
{
  "type": "event" | "person" | "article" | "preference" | "location" | "other",
  "event": {  // only if type is "event"
    "title": "string",
    "start": "YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD if no time",
    "end": "YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD if no time",
    "timezone": "IANA timezone string (e.g. America/Chicago)",
    "location": "full venue address or name",
    "organizer": "string or null",
    "allDay": true/false
  }
}

Extraction rules:
- ALWAYS extract location if any venue, address, city, or place is mentioned — even partial (e.g. "Austin, TX" counts)
- If a specific start TIME is explicitly stated (e.g. "1:30 PM", "9:00 AM"), extract it. If no time is mentioned, set "allDay": true and use date-only format (YYYY-MM-DD)
- If end time is explicitly stated, extract it. If not and start time exists, estimate from context (meetups ~2-3 hours, shows ~3 hours, conferences all day). If allDay is true, set end to same date
- ALWAYS extract timezone from the city/region. US cities: New York=America/New_York, Chicago/Austin/Dallas=America/Chicago, Denver=America/Denver, LA/SF=America/Los_Angeles
- NEVER fabricate a start time. If the content only has a date with no time, it MUST be allDay: true
- If the content is NOT an event, set "type" to the best match and omit the "event" field` },
      { role: "user", content: truncated }
    ];

    // Route through BYOK or server proxy — same logic as chat
    const useBYOK = !!CONFIG.openrouterKey;
    const chatUrl = useBYOK
      ? `${CONFIG.openrouterBase}/chat/completions`
      : `${CONFIG.apiBase}/api/chat/completions`;
    const chatHeaders = useBYOK
      ? { "Content-Type": "application/json", Authorization: `Bearer ${CONFIG.openrouterKey}` }
      : { "Content-Type": "application/json", Authorization: `Bearer ${CONFIG.authToken}` };
    const model = useBYOK ? CONFIG.model : (CONFIG.selectedModel || CONFIG.serverModel || CONFIG.model);

    const res = await fetch(chatUrl, {
      method: "POST",
      headers: chatHeaders,
      body: JSON.stringify({
        model,
        messages: enrichPrompt,
        max_tokens: 800,
        temperature: 0,
        stream: false
      })
    });

    if (!res.ok) {
      console.log(`[Enrich] LLM call failed for trace #${traceId}: ${res.status} ${res.statusText}`);
      return;
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return;

    // Parse JSON — handle possible markdown fences
    const jsonStr = raw.replace(/```json\s*/g, "").replace(/```/g, "").trim();
    const metadata = JSON.parse(jsonStr);

    // PATCH metadata to server
    await authedFetch(`${CONFIG.apiBase}/api/trace/${traceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata })
    });

    console.log(`[Enrich] Trace #${traceId} enriched as "${metadata.type}"`);
  } catch (err) {
    console.log(`[Enrich] Failed for trace #${traceId}:`, err.message);
    // Non-blocking — enrichment failure doesn't affect the saved trace
  }
}

// ============================================================
// Calendar Link Generation
// ============================================================
function generateCalendarLinks(eventMeta) {
  if (!eventMeta?.title || !eventMeta?.start) return null;

  const title = encodeURIComponent(eventMeta.title);
  const location = encodeURIComponent(eventMeta.location || "");
  const desc = encodeURIComponent(eventMeta.organizer ? `Organized by ${eventMeta.organizer}` : "");
  const isAllDay = eventMeta.allDay || !eventMeta.start.includes("T");

  let google, outlook, icsLines;

  if (isAllDay) {
    // All-day: Google uses YYYYMMDD format, next day as end
    const dateClean = eventMeta.start.replace(/-/g, "");
    const startDate = new Date(eventMeta.start + "T00:00:00");
    const nextDay = new Date(startDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const endDateClean = nextDay.toISOString().slice(0, 10).replace(/-/g, "");

    google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dateClean}/${endDateClean}&location=${location}&details=${desc}`;
    outlook = `https://outlook.office.com/calendar/0/action/compose?subject=${title}&startdt=${eventMeta.start}&enddt=${eventMeta.start}&allday=true&location=${location}&body=${desc}`;
    icsLines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//NeuralTrace//EN",
      "BEGIN:VEVENT",
      `DTSTART;VALUE=DATE:${dateClean}`,
      `DTEND;VALUE=DATE:${endDateClean}`,
      `SUMMARY:${eventMeta.title.replace(/,/g, "\\,")}`,
      eventMeta.location ? `LOCATION:${eventMeta.location.replace(/,/g, "\\,")}` : "",
      eventMeta.organizer ? `DESCRIPTION:Organized by ${eventMeta.organizer.replace(/,/g, "\\,")}` : "",
      "END:VEVENT",
      "END:VCALENDAR"
    ].filter(Boolean).join("\r\n");
  } else {
    // Timed event
    const startClean = eventMeta.start.replace(/[-:]/g, "").replace(/\.\d+/, "");
    const endClean = eventMeta.end
      ? eventMeta.end.replace(/[-:]/g, "").replace(/\.\d+/, "")
      : startClean.replace(/T(\d{2})/, (m, h) => `T${String(parseInt(h, 10) + 2).padStart(2, "0")}`);

    google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startClean}/${endClean}${eventMeta.timezone ? `&ctz=${encodeURIComponent(eventMeta.timezone)}` : ""}&location=${location}&details=${desc}`;

    const outlookEnd = eventMeta.end || eventMeta.start.replace(/T(\d{2})/, (m, h) => `T${String(parseInt(h, 10) + 2).padStart(2, "0")}`);
    outlook = `https://outlook.office.com/calendar/0/action/compose?subject=${title}&startdt=${eventMeta.start}&enddt=${outlookEnd}&location=${location}&body=${desc}`;

    icsLines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//NeuralTrace//EN",
      "BEGIN:VEVENT",
      `DTSTART:${startClean}`,
      `DTEND:${endClean}`,
      `SUMMARY:${eventMeta.title.replace(/,/g, "\\,")}`,
      eventMeta.location ? `LOCATION:${eventMeta.location.replace(/,/g, "\\,")}` : "",
      eventMeta.organizer ? `DESCRIPTION:Organized by ${eventMeta.organizer.replace(/,/g, "\\,")}` : "",
      "END:VEVENT",
      "END:VCALENDAR"
    ].filter(Boolean).join("\r\n");
  }

  return { google, outlook, ics: icsLines };
}

function downloadIcs(icsContent, title) {
  const blob = new Blob([icsContent], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Direct Vault Commands (no AI needed)
// ============================================================
function formatTraceCard(trace, showDate = true) {
  const lines = trace.content.split("\n");
  let title = "";
  let url = "";

  // Parse saved format: title\nURL\n\nexcerpt
  for (const line of lines) {
    const trimmed = line.trim();
    if (!title && trimmed) { title = trimmed; continue; }
    if (title && !url && trimmed.startsWith("http")) { url = trimmed; break; }
  }

  // Fallback: no structured format, use raw content
  if (!title) {
    title = trace.content.length > 100 ? trace.content.slice(0, 100) + "..." : trace.content;
  }

  const date = showDate ? new Date(trace.created_at).toLocaleDateString() : "";
  const source = url ? `[View source](${url})` : "";
  const meta = [date, source].filter(Boolean).join(" · ");

  return `**#${trace.id}** ${title}\n${meta}\n`;
}

async function slashSearch(query) {
  appendMessage("user", `/search ${query}`);
  try {
    const res = await authedFetch(`${CONFIG.apiBase}/api/search?q=${encodeURIComponent(query)}&limit=10`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    // Filter out low-relevance results (score < 0.15)
    const relevant = (data.results || []).filter(r => r.score >= 0.15);
    if (relevant.length === 0) {
      appendMessage("assistant", `No results found for "${query}".`);
      return;
    }
    let md = `**Found ${relevant.length} result${relevant.length > 1 ? "s" : ""} for "${query}":**\n\n`;
    for (const r of relevant) {
      md += formatTraceCard(r, false) + "\n";
    }
    appendMessage("assistant", md);
  } catch (err) {
    appendMessage("assistant", `Search failed: ${err.message}`);
  }
}

async function slashList() {
  appendMessage("user", "/list");
  try {
    const res = await authedFetch(`${CONFIG.apiBase}/api/traces?limit=10`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    if (!data.traces || data.traces.length === 0) {
      appendMessage("assistant", "Your vault is empty. Save something first!");
      return;
    }
    let md = `**${data.total} trace${data.total > 1 ? "s" : ""} in your vault** (showing ${data.traces.length}):\n\n`;
    for (const t of data.traces) {
      md += formatTraceCard(t) + "\n";
    }
    appendMessage("assistant", md);
  } catch (err) {
    appendMessage("assistant", `Failed to list traces: ${err.message}`);
  }
}

async function slashDelete(id) {
  const traceId = parseInt(id, 10);
  if (isNaN(traceId)) {
    appendMessage("assistant", "Usage: /delete [id] — provide a numeric trace ID.");
    return;
  }
  appendMessage("user", `/delete ${traceId}`);
  try {
    const res = await authedFetch(`${CONFIG.apiBase}/api/trace/${traceId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Server returned ${res.status}`);
    }
    appendMessage("assistant", `Trace #${traceId} deleted.`);
  } catch (err) {
    appendMessage("assistant", `Delete failed: ${err.message}`);
  }
}

// ============================================================
// Slash Commands
// ============================================================
const SLASH_COMMANDS = [
  { name: "save-page", desc: "Save this page to your vault", action: () => quickSavePage() },
  { name: "summarize-page", desc: "Summarize and review this page", action: () => document.getElementById("qa-summarize").click() },
  { name: "search", desc: "Search your vault", args: "query", action: (q) => slashSearch(q) },
  { name: "list", desc: "Show recent traces in your vault", action: () => slashList() },
  { name: "delete", desc: "Delete a trace by ID", args: "id", action: (id) => slashDelete(id) },
  { name: "new", desc: "Start a new conversation", action: () => $btnNewChat.click() },
  { name: "settings", desc: "Open settings panel", action: () => $btnSettings.click() },
  { name: "help", desc: "Open the quick guide", action: () => $btnGuide.click() },
  { name: "add-calendar", desc: "Add last searched event to calendar", action: () => {
    if (!lastSearchEventMeta) {
      appendMessage("assistant", "No events in this conversation yet. Try searching for one first, then use /add-calendar to add it to your calendar.");
      return;
    }
    const links = generateCalendarLinks(lastSearchEventMeta);
    if (!links) {
      appendMessage("assistant", "Couldn't generate calendar links for this event.");
      return;
    }
    const title = lastSearchEventMeta.title;
    const isAllDay = lastSearchEventMeta.allDay || !lastSearchEventMeta.start.includes("T");
    const dateDisplay = isAllDay ? lastSearchEventMeta.start : lastSearchEventMeta.start.replace("T", " at ");
    appendMessage("assistant",
      `**${title}**\n${dateDisplay}${lastSearchEventMeta.location ? ` — ${lastSearchEventMeta.location}` : ""}\n\n` +
      `[Add to Google Calendar](${links.google})\n\n` +
      `[Add to Outlook](${links.outlook})`
    );
    // Also offer .ics download
    downloadIcs(links.ics, title);
  }}
];

const $slashMenu = document.getElementById("slash-menu");
const $slashList = document.getElementById("slash-menu-list");
let slashSelectedIndex = 0;
let slashFiltered = [];

function showSlashMenu(filter = "") {
  const q = filter.toLowerCase();
  slashFiltered = q
    ? SLASH_COMMANDS.filter(c => c.name.startsWith(q))
    : [...SLASH_COMMANDS];

  if (slashFiltered.length === 0) {
    $slashList.innerHTML = `<div class="slash-menu-empty">No matching commands</div>`;
  } else {
    slashSelectedIndex = 0;
    renderSlashItems();
  }
  $slashMenu.classList.remove("hidden");
}

function renderSlashItems() {
  $slashList.innerHTML = slashFiltered.map((cmd, i) => `
    <div class="slash-menu-item${i === slashSelectedIndex ? " selected" : ""}" data-index="${i}">
      <span class="slash-menu-item-name">/${cmd.name}${cmd.args ? ` [${cmd.args}]` : ""}</span>
      <span class="slash-menu-item-desc">${cmd.desc}</span>
    </div>
  `).join("");

  // Click handlers
  $slashList.querySelectorAll(".slash-menu-item").forEach(el => {
    el.addEventListener("click", () => {
      selectSlashCommand(parseInt(el.dataset.index));
    });
  });
}

function hideSlashMenu() {
  $slashMenu.classList.add("hidden");
  slashFiltered = [];
}

function selectSlashCommand(index) {
  const cmd = slashFiltered[index];
  if (!cmd) return;
  hideSlashMenu();

  if (cmd.args) {
    // Command needs arguments — populate input with the command prefix
    $input.value = `/${cmd.name} `;
    $input.focus();
    return;
  }

  $input.value = "";
  $input.style.height = "auto";
  cmd.action();
}

// Execute slash command from input (when user types /command and hits enter)
function tryExecuteSlash(text) {
  if (!text.startsWith("/")) return false;
  const parts = text.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase();
  const arg = parts.slice(1).join(" ").trim();
  const cmd = SLASH_COMMANDS.find(c => c.name === name);
  if (!cmd) return false;

  $input.value = "";
  $input.style.height = "auto";
  if (cmd.args && arg) {
    cmd.action(arg);
  } else if (!cmd.args) {
    cmd.action();
  } else {
    // Command needs args but none provided — show hint
    appendMessage("assistant", `Usage: /${cmd.name} [${cmd.args}]`);
  }
  return true;
}

// Input listener for slash commands
$input.addEventListener("input", () => {
  const val = $input.value;
  if (val.startsWith("/") && val.indexOf("\n") === -1) {
    const filter = val.slice(1).split(/\s/)[0] || "";
    // Only show menu when typing the command name (no space yet, or no args)
    if (!val.includes(" ") || val === "/") {
      showSlashMenu(filter);
    } else {
      hideSlashMenu();
    }
  } else {
    hideSlashMenu();
  }
});

// Keyboard navigation for slash menu
$input.addEventListener("keydown", (e) => {
  if ($slashMenu.classList.contains("hidden")) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    slashSelectedIndex = Math.min(slashSelectedIndex + 1, slashFiltered.length - 1);
    renderSlashItems();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    slashSelectedIndex = Math.max(slashSelectedIndex - 1, 0);
    renderSlashItems();
  } else if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    selectSlashCommand(slashSelectedIndex);
  } else if (e.key === "Escape") {
    hideSlashMenu();
    $input.value = "";
  }
});

// Close slash menu when clicking outside
document.addEventListener("click", (e) => {
  if (!$slashMenu.contains(e.target) && e.target !== $input) {
    hideSlashMenu();
  }
});

// ============================================================
// Chat Logic
// ============================================================
async function sendMessage() {
  const text = $input.value.trim();
  const hasImages = pendingImages.length > 0;
  if (!text && !hasImages) return;
  if (isStreaming) return;

  // Intercept slash commands before LLM
  hideSlashMenu();
  if (text.startsWith("/") && tryExecuteSlash(text)) return;

  if (!CONFIG.openrouterKey && !CONFIG.authToken) {
    setStatus("Please sign in to chat", true);
    return;
  }

  // Clear welcome screen and any suggestion chips
  const welcome = $messages.querySelector(".welcome");
  if (welcome) welcome.remove();
  const chips = $messages.querySelector(".suggestion-chips");
  if (chips) chips.remove();

  // Build message content
  if (hasImages) {
    // Silently capture current tab URL + title for source attribution
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url && !tab.url.startsWith("chrome")) {
        imageSourceContext = { title: tab.title || tab.url, url: tab.url };
      }
    } catch (_) { /* non-critical — skip silently */ }

    const content = [];
    const imageUrls = [];
    for (const img of pendingImages) {
      content.push({ type: "image_url", image_url: { url: img.dataUrl } });
      imageUrls.push(img.dataUrl);
    }
    if (text) content.push({ type: "text", text });

    appendMessage("user", text, imageUrls);
    chatHistory.push({ role: "user", content });

    // Clear pending images
    pendingImages = [];
    renderImagePreviews();
  } else {
    appendMessage("user", text);
    chatHistory.push({ role: "user", content: text });
  }

  saveConversation(); // persist immediately (fire-and-forget)

  // Clear input
  $input.value = "";
  $input.style.height = "auto";
  $btnSend.disabled = true;

  // Stream response
  toolsUsedThisTurn = [];
  await streamResponse();
}

const MAX_TOOL_ROUNDS = 5;

async function streamResponse(toolRound = 0) {
  if (toolRound >= MAX_TOOL_ROUNDS) {
    appendMessage("assistant", "I've reached the maximum number of tool calls for this turn. Please try again or rephrase your request.");
    isStreaming = false;
    setStatus("");
    return;
  }
  isStreaming = true;
  setStatus("Thinking...");

  const hasImages = currentTurnHasImages();
  const systemContent = hasImages ? SYSTEM_PROMPT + VISION_SUPPLEMENT : SYSTEM_PROMPT;

  // Determine routing: BYOK direct to OpenRouter vs proxy through server
  const useBYOK = !!CONFIG.openrouterKey;
  const useProxy = !useBYOK && !!CONFIG.authToken;

  if (!useBYOK && !useProxy) {
    appendMessage("assistant", "Please sign in to chat.");
    isStreaming = false;
    setStatus("");
    return;
  }

  let chatUrl, chatHeaders, model;

  if (useBYOK) {
    // BYOK: direct to OpenRouter with user's key
    model = hasImages ? VISION_MODEL : CONFIG.model;
    chatUrl = `${CONFIG.openrouterBase}/chat/completions`;
    chatHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CONFIG.openrouterKey}`,
      "HTTP-Referer": "chrome-extension://neuraltrace",
      "X-Title": "NeuralTrace"
    };
    console.log("[chat] routing via BYOK");
  } else {
    // Proxy: server picks the model, Pro users can override with selected model
    model = hasImages ? VISION_MODEL : (CONFIG.selectedModel || CONFIG.serverModel || CONFIG.model);
    chatUrl = `${CONFIG.apiBase}/api/chat/completions`;
    chatHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CONFIG.authToken}`
    };
    console.log("[chat] routing via proxy");
  }

  // Update model badge — use dropdown label if available
  if (hasImages) {
    $modelBadge.textContent = "Gemini Flash (vision)";
  } else {
    const activeModel = model;
    const allModels = [...MODELS_PRO, ...MODELS_BYOK];
    const found = allModels.find(m => m.id === activeModel);
    $modelBadge.textContent = found?.label || activeModel.split("/").pop() || "AI";
  }

  // Strip image data from history when using a non-vision model (e.g. DeepSeek can't handle images)
  const sanitizedHistory = hasImages ? chatHistory : chatHistory.map(msg => {
    if (Array.isArray(msg.content)) {
      // Multimodal message — extract text parts only, replace images with "[Image was shared]"
      const textParts = msg.content
        .filter(p => p.type === "text")
        .map(p => p.text);
      const hadImages = msg.content.some(p => p.type === "image_url");
      const combined = (hadImages ? "[Image was shared]\n" : "") + textParts.join("\n");
      return { ...msg, content: combined.trim() || "[Image was shared]" };
    }
    return msg;
  });

  const messages = [
    { role: "system", content: systemContent },
    ...sanitizedHistory
  ];

  // Build request body — skip tools for vision model (unreliable with multimodal)
  const requestBody = {
    model,
    messages,
    stream: true,
    max_tokens: 1024
  };
  if (!hasImages) {
    requestBody.tools = TOOLS;
  }

  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: chatHeaders,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errText.slice(0, 200)}`);
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantText = "";
    let toolCalls = []; // accumulate tool calls
    let msgEl = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        // Handle proxy error events (data: {"error": "...", "status": N})
        if (parsed.error) {
          console.error("[chat] proxy error:", parsed.error, "status:", parsed.status);
          const errorMsg = `⚠️ ${parsed.error}`;
          if (!msgEl) {
            msgEl = appendMessage("assistant", "");
          }
          msgEl.classList.add("error-message");
          updateMessageContent(msgEl, errorMsg);
          scrollToBottom();
          continue;
        }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        // Text content
        if (delta.content) {
          if (!msgEl) {
            msgEl = appendMessage("assistant", "");
          }
          assistantText += delta.content;
          updateMessageContent(msgEl, assistantText);
          scrollToBottom();
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              if (!toolCalls[tc.index]) {
                toolCalls[tc.index] = {
                  id: tc.id || "",
                  type: "function",
                  function: { name: "", arguments: "" }
                };
              }
              if (tc.id) toolCalls[tc.index].id = tc.id;
              if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
            }
          }
        }
      }
    }

    // Handle tool calls — remove empty bubble from first pass if no meaningful text
    if (toolCalls.length > 0) {
      // Suppress intermediate text — only show final response after all tools complete
      if (msgEl) {
        msgEl.closest(".message")?.remove();
        msgEl = null;
      }
      // Deduplicate: remove duplicate save_trace calls with identical content
      const seen = new Set();
      const dedupedToolCalls = toolCalls.filter(tc => {
        if (tc.function.name === "save_trace") {
          const key = tc.function.arguments;
          if (seen.has(key)) return false;
          seen.add(key);
        }
        return true;
      });

      // Add assistant message with tool calls to history
      chatHistory.push({
        role: "assistant",
        content: assistantText || null,
        tool_calls: dedupedToolCalls
      });

      // Execute each tool call
      for (const tc of dedupedToolCalls) {
        const toolName = tc.function.name;
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {}

        // Show tool indicator
        const toolEl = showToolCall(toolName, args);
        setStatus(`Using ${toolName}...`);

        // Execute the tool
        toolsUsedThisTurn.push(toolName);
        const result = await executeTool(toolName, args);

        // Remove tool indicator
        toolEl.remove();

        // Add tool result to history
        chatHistory.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        });
      }

      // Continue conversation with tool results
      isStreaming = false;
      await streamResponse(toolRound + 1);
      return;
    }

    // Regular text response — parse suggestions and add to history
    if (assistantText) {
      const { text: cleanText, suggestions } = parseSuggestions(assistantText);

      // Always re-render with clean text if the block was found (strips raw markup)
      if (cleanText !== assistantText && msgEl) {
        updateMessageContent(msgEl, cleanText);
      }

      // Render LLM suggestions or fall back to generic ones after vault retrieval
      if (suggestions.length > 0 && msgEl) {
        renderSuggestionChips(suggestions, msgEl);
      } else if (msgEl && isVaultRetrievalTurn()) {
        renderSuggestionChips(getFallbackSuggestions(), msgEl);
      }

      // After page summarize, show "Add to vault" chip
      if (pendingSummarizePage && msgEl) {
        if (pendingSummarizePageData) {
          pendingSummarizePageData.summary = cleanText;
        }
        renderSuggestionChips(["Add to vault"], msgEl);
        pendingSummarizePage = false;
      }

      chatHistory.push({ role: "assistant", content: cleanText });
      await saveConversation();
    }

  } catch (err) {
    console.error("[NeuralTrace] Stream error:", err);
    appendMessage("assistant", `Error: ${err.message}`);
    setStatus(err.message, true);
  }

  isStreaming = false;
  setStatus("");
  // Reset model badge to default for current routing mode
  if (CONFIG.openrouterKey) {
    $modelBadge.textContent = "Qwen 3.5 Flash";
  } else if (CONFIG.serverModel) {
    $modelBadge.textContent = CONFIG.serverModel.split("/").pop() || "AI";
  } else {
    $modelBadge.textContent = "AI";
  }
  $btnSend.disabled = !$input.value.trim() && pendingImages.length === 0;
}

// ============================================================
// Tool Execution
// ============================================================
async function executeTool(name, args) {
  try {
    switch (name) {
      case "search_vault": {
        const res = await authedFetch(
          `${CONFIG.apiBase}/api/search?q=${encodeURIComponent(args.query)}&limit=5`
        );
        if (!res.ok) {
          if (res.status === 403 || res.status === 429) {
            try {
              const errorData = await res.json();
              if (errorData.code && isRateLimitCode(errorData.code)) {
                return { result: `Rate limit reached: ${errorData.current}/${errorData.limit} searches used. Upgrade to Pro for unlimited access.` };
              }
            } catch (_) {}
          }
          return { error: `Search failed: ${res.status}` };
        }
        const data = await res.json();
        if (data.results.length === 0) return { results: [], message: "No matching traces found." };
        // Store event metadata from results for action chips — always reset to prevent stale data
        // Store most recent event metadata for /add-calendar slash command
        const eventResults = data.results.filter(r => r.metadata?.type === "event" && r.metadata?.event);
        lastSearchEventMeta = eventResults.length > 0 ? eventResults[0].metadata.event : null;
        return {
          results: data.results.map(r => ({
            id: r.id,
            content: r.content,
            tags: r.tags,
            created_at: r.created_at,
            score: r.score
          }))
        };
      }

      case "save_trace": {
        // Append source URL if we captured one during image paste
        let content = args.content;
        if (imageSourceContext) {
          content += `\nSource: [${imageSourceContext.title}](${imageSourceContext.url})`;
          imageSourceContext = null;
        }
        const res = await authedFetch(`${CONFIG.apiBase}/api/trace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, tags: args.tags || "" })
        });
        if (!res.ok) {
          if (res.status === 403 || res.status === 429) {
            try {
              const errorData = await res.json();
              if (errorData.code && isRateLimitCode(errorData.code)) {
                return { result: `Rate limit reached: ${errorData.current}/${errorData.limit} traces used. Upgrade to Pro for unlimited access.` };
              }
            } catch (_) {}
          }
          return { error: `Save failed: ${res.status}` };
        }
        const data = await res.json();
        // Background enrichment
        if (data.id && (CONFIG.openrouterKey || CONFIG.authToken)) {
          setTimeout(() => enrichTrace(data.id, content), 500);
        }
        return { saved: true, id: data.id, content };
      }

      case "delete_trace": {
        const res = await authedFetch(`${CONFIG.apiBase}/api/trace/${args.id}`, {
          method: "DELETE"
        });
        if (!res.ok) {
          if (res.status === 403 || res.status === 429) {
            try {
              const errorData = await res.json();
              if (errorData.code && isRateLimitCode(errorData.code)) {
                return { result: `Rate limit reached: ${errorData.current}/${errorData.limit} used. Upgrade to Pro for unlimited access.` };
              }
            } catch (_) {}
          }
          return { error: `Delete failed: ${res.status}` };
        }
        return { deleted: true, id: args.id };
      }

      case "list_traces": {
        const limit = Math.min(args.limit || 20, 50);
        const res = await authedFetch(
          `${CONFIG.apiBase}/api/traces?limit=${limit}`
        );
        if (!res.ok) {
          if (res.status === 403 || res.status === 429) {
            try {
              const errorData = await res.json();
              if (errorData.code && isRateLimitCode(errorData.code)) {
                return { result: `Rate limit reached: ${errorData.current}/${errorData.limit} used. Upgrade to Pro for unlimited access.` };
              }
            } catch (_) {}
          }
          return { error: `List failed: ${res.status}` };
        }
        const data = await res.json();
        return {
          total: data.total,
          traces: data.traces.map(t => ({
            id: t.id,
            content: t.content,
            tags: t.tags,
            created_at: t.created_at
          }))
        };
      }

      case "get_page_context": {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "get-page-content" }, (response) => {
            if (response?.unsupported) {
              resolve({ error: "This page type isn't supported yet." });
            } else if (response) {
              currentPageContext = response;
              if (response.title) {
                $pageContextText.textContent = `Page: ${response.title.slice(0, 40)}`;
                $pageContextBadge.classList.remove("hidden");
                setTimeout(() => $pageContextBadge.classList.add("hidden"), 5000);
              }
              resolve({
                title: response.title,
                url: response.url,
                excerpt: response.text?.slice(0, 4000) || "",
                selection: response.selection || ""
              });
            } else {
              resolve({ error: "Could not access page content" });
            }
          });
        });
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// ============================================================
// UI Helpers
// ============================================================
function appendMessage(role, content, images = null) {
  const div = document.createElement("div");
  div.className = `message ${role}`;

  const roleLabel = document.createElement("div");
  roleLabel.className = `message-role ${role}`;
  roleLabel.textContent = role === "user" ? "You" : "NeuralTrace";

  div.appendChild(roleLabel);

  // Show image thumbnails if present
  if (images && images.length > 0) {
    const imagesDiv = document.createElement("div");
    imagesDiv.className = "message-images";
    for (const dataUrl of images) {
      const img = document.createElement("img");
      img.className = "message-image-thumb";
      img.src = dataUrl;
      img.alt = "Attached image";
      img.addEventListener("click", () => openLightbox(dataUrl));
      imagesDiv.appendChild(img);
    }
    div.appendChild(imagesDiv);
  }

  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  contentDiv.innerHTML = renderMarkdown(content);

  // Skip empty text bubble when user sends images without text
  if (content || role === "assistant") {
    div.appendChild(contentDiv);
  }

  // Copy button for assistant messages
  if (role === "assistant" && content) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-copy-btn";
    copyBtn.title = "Copy message";
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
    copyBtn.addEventListener("click", () => {
      const text = contentDiv.innerText;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
          copyBtn.classList.remove("copied");
        }, 2000);
      });
    });
    div.appendChild(copyBtn);
  }

  $messages.appendChild(div);
  scrollToBottom();

  return contentDiv;
}

// Image lightbox
const $lightbox = document.createElement("div");
$lightbox.id = "image-lightbox";
$lightbox.className = "hidden";
$lightbox.addEventListener("click", () => $lightbox.classList.add("hidden"));
document.body.appendChild($lightbox);

function openLightbox(dataUrl) {
  $lightbox.innerHTML = "";
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "Full size image";
  $lightbox.appendChild(img);
  $lightbox.classList.remove("hidden");
}

function updateMessageContent(el, text) {
  // Hide SUGGESTIONS markup during streaming (strips from first marker onward)
  const display = text.replace(/<?<?SUGGESTIONS>?>?>[\s\S]*/i, "").trimEnd();
  el.innerHTML = renderMarkdown(display);
}

function showToolCall(name, args) {
  const div = document.createElement("div");
  div.className = "tool-call";
  const label = {
    search_vault: `Searching vault: "${args.query || ""}"`,
    save_trace: "Saving to vault...",
    delete_trace: `Deleting trace #${args.id || ""}`,
    list_traces: "Loading vault contents...",
    get_page_context: "Reading current page..."
  }[name] || name;
  div.innerHTML = `<div class="spinner"></div><span>${label}</span>`;
  $messages.appendChild(div);
  scrollToBottom();
  return div;
}

function showWelcome() {
  $messages.innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">
        <img src="icons/logo.png" alt="NeuralTrace" class="welcome-logo">
      </div>
      <p class="welcome-title">Your vault's voice</p>
      <p class="welcome-sub">Ask me anything about what you've saved, or save something new.</p>
      <div class="quick-actions">
        <button class="chip" data-prompt="What's in my vault?">What's in my vault?</button>
        <button class="chip" data-prompt="What do I know about this page?">About this page</button>
        <button class="chip" data-prompt="Save this page to my vault">Save this page</button>
      </div>
    </div>`;

  // Re-bind chip listeners (must include fast-path for save)
  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const prompt = chip.dataset.prompt;
      if (prompt === "Save this page to my vault") {
        quickSavePage();
        return;
      }
      $input.value = prompt;
      $input.dispatchEvent(new Event("input"));
      sendMessage();
    });
  });
}

function showNotification(message, type = "info") {
  const container = document.getElementById("notification-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `notification-toast notification-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    toast.classList.add("notification-fade-out");
    toast.addEventListener("animationend", () => toast.remove());
  }, 5000);

  console.log(`[notification] type=${type} message=${message}`);
}

function setStatus(text, isError = false) {
  $statusText.textContent = text;
  $statusText.className = isError ? "error" : "";
}

function scrollToBottom() {
  $messages.scrollTop = $messages.scrollHeight;
}

// ============================================================
// Suggestion Chips (post-retrieval follow-ups)
// ============================================================
function parseSuggestions(text) {
  const match = text.match(/<?<?SUGGESTIONS>?>?>(.*?)<?<?\/?\/?SUGGESTIONS>?>?>/s)
    || text.match(/SUGGESTIONS>>(.*?)SUGGESTIONS>>/s);
  if (!match) return { text, suggestions: [] };

  const cleanText = text.replace(match[0], "").replace(/\n---\s*$/, "").trimEnd();
  const raw = match[1];

  // Try || delimiter first, fall back to | (LLMs are inconsistent)
  let suggestions = raw.split("||").map(s => s.trim()).filter(s => s.length > 0 && s.length <= 60);
  if (suggestions.length === 0) {
    suggestions = raw.split("|").map(s => s.trim()).filter(s => s.length > 0 && s.length <= 60);
  }

  return { text: cleanText, suggestions };
}

function renderSuggestionChips(suggestions, msgEl) {
  if (!suggestions.length) return;

  // Remove any existing suggestion chips in the messages area
  const existing = $messages.querySelector(".suggestion-chips");
  if (existing) existing.remove();

  const container = document.createElement("div");
  container.className = "suggestion-chips";

  for (const suggestion of suggestions) {
    const btn = document.createElement("button");
    btn.className = "suggestion-chip";
    btn.textContent = suggestion;
    btn.addEventListener("click", async () => {
      container.remove();

      // Intercept "Add to vault" from Summarize Page — direct save with source attribution
      if (suggestion === "Add to vault" && pendingSummarizePageData?.summary) {
        const { title, url, summary } = pendingSummarizePageData;
        pendingSummarizePageData = null;

        const content = `${title}\n${url}\n\n${summary}`;
        const tags = title.split(/[\s\-|:,]+/).filter(w => w.length > 3).slice(0, 5).join(", ").toLowerCase();

        appendMessage("user", "Add to vault");
        setStatus("Saving to vault...");

        try {
          const res = await authedFetch(`${CONFIG.apiBase}/api/trace`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, tags })
          });

          if (!res.ok) {
            if (res.status === 403 || res.status === 429) {
              try {
                const errorData = await res.json();
                if (errorData.code && isRateLimitCode(errorData.code)) {
                  appendMessage("assistant", `Rate limit reached: ${errorData.current}/${errorData.limit} saves used. Upgrade to Pro for unlimited access.`);
                  setStatus("");
                  return;
                }
              } catch (_) {}
            }
            appendMessage("assistant", `Save failed (${res.status}). Please try again.`);
            setStatus("");
            return;
          }

          const data = await res.json();
          appendMessage("assistant", `**Saved to vault.** ${title}`);
          setStatus("");

          chatHistory.push({ role: "user", content: "Add to vault" });
          chatHistory.push({ role: "assistant", content: `Saved to vault. ${title} (trace #${data.id})` });
          saveConversation();

          if (data.id && (CONFIG.openrouterKey || CONFIG.authToken)) {
            setTimeout(() => enrichTrace(data.id, content), 500);
          }
        } catch (err) {
          appendMessage("assistant", `Error: ${err.message}`);
          setStatus("");
        }
        return;
      }

      // Default: send suggestion as next message
      $input.value = suggestion;
      $input.dispatchEvent(new Event("input"));
      sendMessage();
    });
    container.appendChild(btn);
  }

  // Insert after the message that contains msgEl
  const messageDiv = msgEl.closest(".message");
  if (messageDiv) {
    messageDiv.after(container);
  } else {
    $messages.appendChild(container);
  }
  scrollToBottom();
}

function isVaultRetrievalTurn() {
  return toolsUsedThisTurn.some(t => t === "search_vault" || t === "list_traces");
}

function getFallbackSuggestions() {
  if (toolsUsedThisTurn.includes("search_vault")) {
    return ["Search for something else", "Save a new memory", "What's in my vault?"];
  }
  if (toolsUsedThisTurn.includes("list_traces")) {
    return ["Search for a topic", "Clean up old traces", "Save something new"];
  }
  return [];
}

// ============================================================
// Markdown Rendering (lightweight)
// ============================================================
function renderMarkdown(text) {
  if (!text) return "";

  // Extract code blocks first (protect from other transforms)
  const codeBlocks = [];
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(`<pre><code>${code.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });

  // Escape HTML
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Restore code blocks
  html = html.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[i]);

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Headings (## and ###)
  html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Line breaks → paragraphs
  html = html.replace(/\n\n+/g, "</p><p>");
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>(<pre>)/g, "$1");
  html = html.replace(/(<\/pre>)<\/p>/g, "$1");
  html = html.replace(/<p>(<ul>)/g, "$1");
  html = html.replace(/(<\/ul>)<\/p>/g, "$1");
  html = html.replace(/<p>(<blockquote>)/g, "$1");
  html = html.replace(/(<\/blockquote>)<\/p>/g, "$1");
  html = html.replace(/<p>(<h[34]>)/g, "$1");
  html = html.replace(/(<\/h[34]>)<\/p>/g, "$1");

  return html;
}

// ============================================================
// Boot
// ============================================================
init();
