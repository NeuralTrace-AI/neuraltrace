import type Database from "better-sqlite3";
import { getSetting, setSetting } from "./database.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface EmbeddingConfig {
  providerUrl: string;
  model: string;
  apiKey: string;
  dimensions: number | null;
}

let embeddingConfig: EmbeddingConfig | null = null;

export function resolveEmbeddingConfig(): void {
  const providerUrl = process.env.EMBEDDING_PROVIDER_URL;
  const model = process.env.EMBEDDING_MODEL;
  const apiKey = process.env.EMBEDDING_API_KEY ?? "";
  const rawDimensions = process.env.EMBEDDING_DIMENSIONS;
  const parsedDimensions = rawDimensions ? Number(rawDimensions) : NaN;
  const dimensions = rawDimensions && !isNaN(parsedDimensions) ? parsedDimensions : null;

  if (providerUrl && model) {
    embeddingConfig = { providerUrl, model, apiKey, dimensions };
    console.log(`[embeddings] Provider resolved: explicit config (${providerUrl}, model: ${model})`);
    return;
  }

  if (OPENAI_API_KEY && OPENAI_API_KEY !== "your-openai-api-key-here") {
    embeddingConfig = {
      providerUrl: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
      apiKey: OPENAI_API_KEY,
      dimensions: dimensions ?? 512,
    };
    console.log("[embeddings] Provider resolved: OpenAI (legacy OPENAI_API_KEY)");
    return;
  }

  console.warn("[embeddings] WARNING: No embedding provider configured. Embedding-dependent features will be unavailable.");
  embeddingConfig = null;
}

export function hasEmbeddingProvider(): boolean {
  return embeddingConfig !== null;
}

export function getEmbeddingModelName(): string | null {
  return embeddingConfig?.model ?? null;
}

export async function getEmbedding(text: string): Promise<number[]> {
  if (!embeddingConfig) {
    throw new Error("No embedding provider configured. Set EMBEDDING_PROVIDER_URL + EMBEDDING_MODEL or OPENAI_API_KEY.");
  }

  const { providerUrl, model, apiKey, dimensions } = embeddingConfig;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const body: Record<string, unknown> = { input: text, model };
  if (dimensions !== null) {
    body["dimensions"] = dimensions;
  }

  const response = await fetch(`${providerUrl}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${err}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  return data.data[0].embedding;
}

export async function checkAndMigrateEmbeddings(db: Database.Database): Promise<void> {
  // No provider configured — nothing to do
  if (!embeddingConfig) return;

  const storedModel = getSetting("embedding_model", db);

  // Fresh install — no model recorded yet. Store current and return.
  if (storedModel === null) {
    setSetting("embedding_model", embeddingConfig.model, db);
    console.log(`[Embedding] Model recorded: ${embeddingConfig.model}`);
    return;
  }

  // Same model — no migration needed
  if (storedModel === embeddingConfig.model) {
    console.log(`[Embedding] Model unchanged (${storedModel}). No migration needed.`);
    return;
  }

  console.log(`[Embedding] Model changed: ${storedModel} → ${embeddingConfig.model}. Re-embedding all traces...`);

  // Connectivity check before committing to a full migration
  try {
    await getEmbedding("test");
  } catch (err) {
    console.error(`[Embedding] Connectivity check failed — falling back to keyword-only search.`, err);
    return;
  }

  const traces = db.prepare("SELECT id, content FROM traces").all() as Array<{ id: number; content: string }>;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i];
    try {
      const vector = await getEmbedding(trace.content);
      db.prepare("UPDATE traces SET vector = ? WHERE id = ?").run(JSON.stringify(vector), trace.id);
      updated++;
    } catch (err) {
      console.warn(`[Embedding] Failed to re-embed trace ${trace.id}, skipping.`, err);
      failed++;
    }
    if ((i + 1) % 50 === 0) {
      console.log(`[Embedding] Progress: ${i + 1}/${traces.length} traces processed.`);
    }
  }

  // Only persist the new model name after ALL traces have been processed (crash safety)
  setSetting("embedding_model", embeddingConfig.model, db);
  console.log(`[Embedding] Re-embedding complete. ${updated} updated, ${failed} failed.`);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function recencyWeight(createdAt: string, decayRate = 0.005): number {
  const now = Date.now();
  const created = new Date(createdAt.endsWith("Z") ? createdAt : createdAt + "Z").getTime();
  const ageDays = Math.max(0, (now - created) / (1000 * 60 * 60 * 24));
  return 1 / (1 + ageDays * decayRate);
}

export function keywordScore(content: string, tags: string | null, query: string): number {
  const lowerContent = content.toLowerCase();
  const lowerTags = (tags || "").toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  let matched = 0;
  for (const term of terms) {
    if (lowerContent.includes(term) || lowerTags.includes(term)) matched++;
  }
  return matched / terms.length;
}

export async function extractSuggestedTraces(summary: string): Promise<Array<{ content: string; tags: string }>> {
  if (!OPENAI_API_KEY || OPENAI_API_KEY === "your-openai-api-key-here") {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `You extract key decisions, preferences, and reusable facts from conversation summaries. Return a JSON array of objects with "content" (the memory to save, written as a clear standalone statement) and "tags" (comma-separated relevant keywords). Only extract things worth remembering long-term — skip transient or obvious info. Return 1-5 items max. Return ONLY the JSON array, no other text.`,
        },
        { role: "user", content: summary },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${err}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const raw = data.choices[0]?.message?.content?.trim() || "[]";
  const cleaned = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
  return JSON.parse(cleaned) as Array<{ content: string; tags: string }>;
}
