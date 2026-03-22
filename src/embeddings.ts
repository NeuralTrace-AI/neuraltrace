const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 512; // MRL: 512d with <3% quality loss vs 1536d

export async function getEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY || OPENAI_API_KEY === "your-openai-api-key-here") {
    throw new Error("OPENAI_API_KEY is not set in .env");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${err}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  return data.data[0].embedding;
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
