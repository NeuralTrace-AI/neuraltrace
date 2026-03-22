import { getUnprocessedTraces, markAsProcessed, insertConsolidatedTrace, type Trace } from "./database.js";
import { getEmbedding } from "./embeddings.js";

// --- Config ---
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const CONSOLIDATION_MODEL = process.env.CONSOLIDATION_MODEL || "qwen/qwen3.5-flash-02-23";
const MIN_BATCH_SIZE = 3; // Don't consolidate tiny batches

// --- Idempotency guard ---
let isConsolidating = false;

// --- Types ---
interface ConsolidatedEntry {
  content: string;
  type: "summary" | "insight";
  tags: string;
  consolidated_from: string; // comma-separated IDs
}

// --- Core consolidation function ---
export async function runConsolidation(dryRun = false): Promise<void> {
  if (isConsolidating) {
    console.log("[Consolidator] Already running — skipping");
    return;
  }

  isConsolidating = true;
  const startTime = Date.now();

  try {
    // 1. Query unprocessed traces
    const traces = getUnprocessedTraces(20);

    if (traces.length < MIN_BATCH_SIZE) {
      console.log(`[Consolidator] Only ${traces.length} unprocessed traces (min: ${MIN_BATCH_SIZE}) — skipping`);
      return;
    }

    console.log(`[Consolidator] Processing ${traces.length} unprocessed traces${dryRun ? " (DRY RUN)" : ""}`);

    // 2. Build LLM prompt
    const traceData = traces.map(t => ({
      id: t.id,
      created_at: t.created_at,
      content: t.content,
      source: t.source,
      tags: t.tags,
    }));

    const prompt = buildConsolidationPrompt(traceData);

    // 3. Call LLM
    const consolidated = await callLLM(prompt);

    if (!consolidated || consolidated.length === 0) {
      console.log("[Consolidator] LLM returned no consolidated entries");
      // Still mark as processed to avoid reprocessing
      if (!dryRun) {
        markAsProcessed(traces.map(t => t.id));
        console.log(`[Consolidator] Marked ${traces.length} traces as processed (no consolidation needed)`);
      }
      return;
    }

    console.log(`[Consolidator] LLM produced ${consolidated.length} consolidated entries`);

    if (dryRun) {
      // Log what would happen without writing
      for (const entry of consolidated) {
        console.log(`[Consolidator] [DRY RUN] Would insert: type=${entry.type}, tags="${entry.tags}", from=[${entry.consolidated_from}]`);
        console.log(`[Consolidator] [DRY RUN]   Content: "${entry.content.substring(0, 100)}${entry.content.length > 100 ? "..." : ""}"`);
      }
      console.log(`[Consolidator] [DRY RUN] Would mark ${traces.length} traces as processed`);
      return;
    }

    // 4. Insert consolidated entries with embeddings
    let insertedCount = 0;
    for (const entry of consolidated) {
      try {
        // Parse source IDs
        const sourceIds = entry.consolidated_from
          .split(",")
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n));

        // Generate embedding for consolidated content
        let vector: string | null = null;
        try {
          const embedding = await getEmbedding(entry.content);
          vector = JSON.stringify(embedding);
        } catch (err) {
          console.error("[Consolidator] Embedding failed for consolidated entry:", err);
        }

        const id = insertConsolidatedTrace(
          entry.content,
          entry.tags,
          vector,
          entry.type,
          sourceIds
        );
        insertedCount++;
        console.log(`[Consolidator] Inserted consolidated trace id=${id} type=${entry.type} from=[${sourceIds.join(",")}]`);
      } catch (err) {
        console.error("[Consolidator] Failed to insert consolidated entry:", err);
      }
    }

    // 5. Mark originals as processed
    const processedIds = traces.map(t => t.id);
    const changed = markAsProcessed(processedIds);
    console.log(`[Consolidator] Marked ${changed} traces as processed`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Consolidator] Complete: ${insertedCount} entries created from ${traces.length} raw traces in ${elapsed}s`);

  } catch (err) {
    console.error("[Consolidator] Error during consolidation:", err);
  } finally {
    isConsolidating = false;
  }
}

// --- Consolidation loop ---
export function startConsolidationLoop(intervalMs: number, dryRun = false): NodeJS.Timeout | null {
  if (!OPENROUTER_API_KEY) {
    console.log("[Consolidator] Skipped — OPENROUTER_API_KEY not set");
    return null;
  }

  console.log(`[Consolidator] Starting loop: interval=${Math.round(intervalMs / 60000)}min, dryRun=${dryRun}`);

  // Run once on startup after a short delay
  setTimeout(() => runConsolidation(dryRun), 5000);

  // Then run on interval
  return setInterval(() => runConsolidation(dryRun), intervalMs);
}

// --- LLM prompt builder ---
function buildConsolidationPrompt(traces: Array<{
  id: number;
  created_at: string;
  content: string;
  source: string | null;
  tags: string | null;
}>): string {
  const tracesJson = JSON.stringify(traces, null, 2);

  return `You are a memory consolidator for a cross-AI system. Here are recent raw memory entries:

${tracesJson}

Tasks:
1. Identify duplicates / near-duplicates → merge them
2. Extract key facts, preferences, ongoing projects, insights
3. Find connections across entries (e.g. "this bug relates to project X from last week")
4. Generate 1–5 concise consolidated entries (summaries/insights)
5. Output ONLY JSON: array of new trace objects to INSERT:
   [{ "content": "...", "type": "summary"|"insight", "tags": "...", "consolidated_from": "id1,id2" }]

Rules:
- Look for patterns across different sources (e.g. a preference mentioned via Claude that reappears in a Grok response, or an extension capture that confirms a decision made in another AI). Prioritize cross-platform connections.
- "type" must be either "summary" or "insight"
- "consolidated_from" must be a comma-separated list of the original entry IDs that this consolidation covers
- "tags" should be comma-separated keywords
- Keep summaries concise but complete — they replace the originals for search purposes
- If entries are all unique with no overlap, still create 1-2 summary entries capturing the key themes
- Do NOT output explanations — just the JSON array`;
}

// --- LLM caller ---
async function callLLM(prompt: string): Promise<ConsolidatedEntry[]> {
  if (!OPENROUTER_API_KEY) {
    console.error("[Consolidator] OPENROUTER_API_KEY not set — cannot consolidate");
    return [];
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.BASE_URL || "http://localhost:3000",
      "X-Title": "NeuralTrace Consolidator",
    },
    body: JSON.stringify({
      model: CONSOLIDATION_MODEL,
      temperature: 0.3,
      messages: [
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`[Consolidator] LLM API error (${response.status}): ${err.substring(0, 500)}`);
    return [];
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  let raw = data.choices?.[0]?.message?.content?.trim() || "[]";

  // Strip thinking tags (some models like Qwen wrap output in <think>...</think>)
  raw = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();

  // Clean markdown fences if present
  const cleaned = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "");

  try {
    const parsed = JSON.parse(cleaned) as ConsolidatedEntry[];

    // Validate structure
    if (!Array.isArray(parsed)) {
      console.error("[Consolidator] LLM returned non-array:", cleaned.substring(0, 200));
      return [];
    }

    // Filter valid entries
    return parsed.filter(entry => {
      if (!entry.content || typeof entry.content !== "string") return false;
      if (entry.type !== "summary" && entry.type !== "insight") return false;
      if (!entry.consolidated_from || typeof entry.consolidated_from !== "string") return false;
      return true;
    });
  } catch (err) {
    console.error("[Consolidator] Failed to parse LLM JSON:", cleaned.substring(0, 200));
    return [];
  }
}
