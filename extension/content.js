// NeuralTrace — Content Script
// Extracts page content using Readability.js with fallbacks

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "extract-page") {
    sendResponse(extractPageContent());
    return true;
  }
});

function extractPageContent() {
  const url = window.location.href;

  // Graceful failure: unsupported page types
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") ||
      url.startsWith("about:") || url.startsWith("edge://")) {
    return { title: document.title, url, text: "", description: "", ogImage: "", selection: "", unsupported: true };
  }

  // Meta tags (always extract regardless of method)
  const description =
    document.querySelector('meta[property="og:description"]')?.content ||
    document.querySelector('meta[name="description"]')?.content || "";
  const ogImage =
    document.querySelector('meta[property="og:image"]')?.content || "";
  const selection = window.getSelection()?.toString() || "";

  let text = "";
  let title = document.title;

  // Strategy 1: JSON-LD articleBody (cleanest when available)
  try {
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldScripts) {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item.articleBody && item.articleBody.length > 200) {
          text = item.articleBody.slice(0, 10000);
          if (item.headline) title = item.headline;
          return { title, url, text, description, ogImage, selection };
        }
      }
    }
  } catch (_) { /* JSON-LD parse failed — continue to next strategy */ }

  // Strategy 2: Readability.js (battle-tested article extraction)
  try {
    if (typeof Readability !== "undefined" && typeof isProbablyReaderable !== "undefined") {
      if (isProbablyReaderable(document)) {
        const documentClone = document.cloneNode(true);
        const article = new Readability(documentClone).parse();
        if (article && article.textContent && article.textContent.length > 100) {
          text = article.textContent.slice(0, 10000);
          title = article.title || title;
          return { title, url, text, description, ogImage, selection };
        }
      }
    }
  } catch (_) { /* Readability failed — continue to fallback */ }

  // Strategy 3: CSS selector cascade (original fallback)
  const contentEl =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.body;
  text = contentEl?.innerText?.slice(0, 10000) || "";

  return { title, url, text, description, ogImage, selection };
}
