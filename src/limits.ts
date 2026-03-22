// ─── Shared Plan Limits (single source of truth) ───

export const PLAN_LIMITS: Record<string, { traces: number; searches: number; apiKeys: number }> = {
  free: { traces: 50, searches: 25, apiKeys: 1 },
  pro: { traces: Infinity, searches: Infinity, apiKeys: Infinity },
};

export const UPGRADE_URL = process.env.BASE_URL ? `${process.env.BASE_URL}/upgrade` : "http://localhost:3000/upgrade";

export interface RateLimitResponse {
  error: string;
  code: string;
  limit: number;
  current: number;
  upgradeUrl: string;
}

export function getRateLimitResponse(
  code: string,
  limit: number,
  current: number
): RateLimitResponse {
  const typeLabels: Record<string, string> = {
    trace_limit: "trace storage limit",
    search_limit: "daily search limit",
    api_key_limit: "API key limit",
  };
  const label = typeLabels[code] || "rate limit";
  return {
    error: `You've reached your ${label}. Upgrade to Pro for unlimited access.`,
    code,
    limit,
    current,
    upgradeUrl: UPGRADE_URL,
  };
}
