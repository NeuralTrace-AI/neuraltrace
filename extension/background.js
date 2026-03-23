// NeuralTrace — Background Service Worker

// Open side panel on toolbar icon click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Context menu: "Remember this" for selected text
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "nt-save-selection",
    title: "Remember this with NeuralTrace",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "nt-save-page",
    title: "Save Page",
    contexts: ["page"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "nt-save-selection" && info.selectionText) {
    const pageUrl = tab?.url || "";
    const pageTitle = tab?.title || "";
    const content = `${info.selectionText}\n\nSource: ${pageTitle} (${pageUrl})`;

    try {
      const config = await getConfig();
      const res = await fetch(`${config.apiBase}/api/trace`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.authToken}`
        },
        body: JSON.stringify({ content, tags: "web-capture" })
      });

      if (res.ok) {
        const data = await res.json();
        // Notify side panel
        chrome.runtime.sendMessage({
          type: "trace-saved",
          trace: { id: data.id, content, tags: "web-capture" }
        }).catch(() => {});
      }
    } catch (err) {
      console.error("[NeuralTrace] Save failed:", err);
    }
  }

  if (info.menuItemId === "nt-save-page" && tab) {
    // Immediate feedback — don't wait for AI summary
    chrome.runtime.sendMessage({ type: "trace-saving", title: tab.title || "page" }).catch(() => {});

    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageContent
      });

      if (result?.result) {
        const { title, url, text, description, ogImage } = result.result;
        const excerpt = text.slice(0, 3000);

        // Build raw content for AI summarization
        const rawContent = `Page: ${title}\nURL: ${url}${description ? `\nDescription: ${description}` : ""}${ogImage ? `\nImage: ${ogImage}` : ""}\n\nContent: ${excerpt}`;

        // Try AI summary, fall back to raw content
        const config = await getConfig();
        let content;
        try {
          content = await summarizePage(config, title, url, description, excerpt, ogImage);
        } catch (err) {
          console.warn("[NeuralTrace] AI summary failed, saving raw:", err);
          content = rawContent;
        }

        const res = await fetch(`${config.apiBase}/api/trace`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.authToken}`
          },
          body: JSON.stringify({ content, tags: "page-capture" })
        });

        if (res.ok) {
          chrome.runtime.sendMessage({
            type: "trace-saved",
            trace: { id: (await res.json()).id, content, tags: "page-capture" }
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error("[NeuralTrace] Page save failed:", err);
    }
  }
});

// Smart page content extraction — JSON-LD → selector cascade
function extractPageContent() {
  let title = document.title;
  const url = window.location.href;

  const description =
    document.querySelector('meta[property="og:description"]')?.content ||
    document.querySelector('meta[name="description"]')?.content || "";
  const ogImage =
    document.querySelector('meta[property="og:image"]')?.content || "";

  let text = "";

  // Strategy 1: JSON-LD articleBody
  try {
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldScripts) {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item.articleBody && item.articleBody.length > 200) {
          text = item.articleBody.slice(0, 10000);
          if (item.headline) title = item.headline;
          return { title, url, text, description, ogImage };
        }
      }
    }
  } catch (_) {}

  // Strategy 2: CSS selector cascade (Readability.js not available here — runs via executeScript)
  const contentEl =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.body;
  text = contentEl?.innerText?.slice(0, 10000) || "";

  return { title, url, text, description, ogImage };
}

// AI-powered page summarization via OpenRouter (BYOK) or server proxy (cloud)
async function summarizePage(config, title, url, description, excerpt, ogImage) {
  const useBYOK = !!config.openrouterKey;
  const useProxy = !useBYOK && !!config.authToken;

  if (!useBYOK && !useProxy) throw new Error("No API key or auth token");

  const chatUrl = useBYOK
    ? "https://openrouter.ai/api/v1/chat/completions"
    : `${config.apiBase}/api/chat/completions`;

  const chatHeaders = useBYOK
    ? {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.openrouterKey}`,
        "HTTP-Referer": "chrome-extension://neuraltrace",
        "X-Title": "NeuralTrace"
      }
    : {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.authToken}`
      };

  const res = await fetch(chatUrl, {
    method: "POST",
    headers: chatHeaders,
    body: JSON.stringify({
      model: "qwen/qwen3.5-flash-02-23",
      max_tokens: 600,
      stream: false,
      messages: [{
        role: "user",
        content: `Summarize this web page in 2-3 sentences for a personal memory vault. Focus on what the page is about and why someone would save it. Be concise and factual.\n\nTitle: ${title}\nURL: ${url}${description ? `\nMeta description: ${description}` : ""}\n\nPage content:\n${excerpt}`
      }]
    })
  });

  if (!res.ok) throw new Error(`AI summary ${res.status}`);
  const data = await res.json();
  const summary = data.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new Error("Empty summary");

  return `Page: ${title}\nURL: ${url}${ogImage ? `\nImage: ${ogImage}` : ""}\n\nSummary: ${summary}`;
}

// Message handler for side panel requests
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "get-page-content") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          sendResponse({ title: "", url: "", text: "", selection: "" });
          return;
        }
        // Use content script (already injected on all pages) instead of scripting.executeScript
        // which requires activeTab permission that expires on navigation
        chrome.tabs.sendMessage(tab.id, { type: "extract-page" }, (response) => {
          if (chrome.runtime.lastError || !response) {
            // Content script not ready — fall back to tab metadata
            sendResponse({ title: tab.title || "", url: tab.url || "", text: "", selection: "" });
          } else {
            sendResponse(response);
          }
        });
      } catch (err) {
        console.error("[NeuralTrace] Page content extraction failed:", err);
        sendResponse({ title: "", url: "", text: "", selection: "" });
      }
    })();
    return true; // async response
  }
});

// Config helper
async function getConfig() {
  const stored = await chrome.storage.local.get(["apiBase", "authToken", "openrouterKey", "jwt", "authMode"]);
  // Prefer JWT (cloud mode) over legacy authToken (self-hosted)
  const authToken = stored.jwt || stored.authToken || "";
  return {
    apiBase: stored.apiBase || "http://localhost:3000",
    authToken,
    openrouterKey: stored.openrouterKey || ""
  };
}
