import { Request, Response, NextFunction } from "express";
import { verifyJwt, validateApiKey, type JwtPayload } from "./auth.js";
import { findUserById, getTraceCount, getApiKeyCount, checkAndIncrementSearch, resolveDb } from "./database.js";
import { PLAN_LIMITS, getRateLimitResponse } from "./limits.js";

const isCloud = process.env.NEURALTRACE_MODE === "cloud";

// Extend Express Request to include authenticated user info
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      userPlan?: string;
    }
  }
}

/**
 * Auth middleware for cloud mode.
 * Accepts either:
 * - Bearer JWT token (from magic link sign-in)
 * - Bearer nt_* API key (for MCP connections)
 *
 * In self-hosted mode, skips auth entirely and sets no userId (single-user).
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isCloud) {
    // Self-hosted: no auth required, single user
    req.userId = undefined;
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "unauthorized",
      message: "Missing or invalid Authorization header. Expected: Bearer <token>",
    });
    return;
  }

  const token = authHeader.slice(7);

  // API key (nt_* prefix)
  if (token.startsWith("nt_")) {
    const userId = validateApiKey(token);
    if (!userId) {
      res.status(401).json({
        error: "unauthorized",
        message: "Invalid API key",
      });
      return;
    }
    req.userId = userId;
    // Look up user plan for rate limiting
    const user = findUserById(userId);
    if (user) {
      req.userPlan = user.plan;
      req.userEmail = user.email;
    }
    next();
    return;
  }

  // JWT
  const payload = verifyJwt(token);
  if (!payload) {
    res.status(401).json({
      error: "unauthorized",
      message: "Invalid or expired JWT token",
    });
    return;
  }

  req.userId = payload.userId;
  req.userEmail = payload.email;
  req.userPlan = payload.plan;
  next();
}

/**
 * Stricter middleware for endpoints that require auth even in self-hosted mode
 * (e.g., account management endpoints that don't exist in self-hosted).
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "unauthorized",
      message: "Authentication required",
    });
    return;
  }

  const token = authHeader.slice(7);

  if (token.startsWith("nt_")) {
    const userId = validateApiKey(token);
    if (!userId) {
      res.status(401).json({ error: "unauthorized", message: "Invalid API key" });
      return;
    }
    req.userId = userId;
    const user = findUserById(userId);
    if (user) {
      req.userPlan = user.plan;
      req.userEmail = user.email;
    }
    next();
    return;
  }

  const payload = verifyJwt(token);
  if (!payload) {
    res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
    return;
  }

  req.userId = payload.userId;
  req.userEmail = payload.email;
  req.userPlan = payload.plan;
  next();
}

// ─── Rate Limit Middleware (M003/S02) ───

/**
 * Trace limit: blocks free users at 50 traces (lifetime cap).
 * Returns 403 with upgrade prompt.
 */
export function traceLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isCloud) { next(); return; }

  const plan = req.userPlan || "free";
  if (plan === "pro") { next(); return; }

  const userId = req.userId;
  if (!userId) { next(); return; }

  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const userDb = resolveDb(userId);
  const current = getTraceCount(userDb);
  const blocked = current >= limits.traces;

  console.log(`[rate-limit] type=trace userId=${userId} plan=${plan} current=${current} limit=${limits.traces} blocked=${blocked}`);

  if (blocked) {
    res.status(403).json(getRateLimitResponse("trace_limit", limits.traces, current));
    return;
  }

  next();
}

/**
 * Search limit: blocks free users at 25 searches/day (daily cap).
 * Returns 429 with upgrade prompt.
 */
export function searchLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isCloud) { next(); return; }

  const plan = req.userPlan || "free";
  if (plan === "pro") { next(); return; }

  const userId = req.userId;
  if (!userId) { next(); return; }

  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const result = checkAndIncrementSearch(userId, limits.searches);
  const blocked = !result.allowed;

  console.log(`[rate-limit] type=search userId=${userId} plan=${plan} current=${result.current} limit=${result.limit} blocked=${blocked}`);

  if (blocked) {
    res.status(429).json(getRateLimitResponse("search_limit", result.limit, result.current));
    return;
  }

  next();
}

/**
 * API key limit: blocks free users at 1 API key (lifetime cap).
 * Returns 403 with upgrade prompt.
 */
export function apiKeyLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isCloud) { next(); return; }

  const plan = req.userPlan || "free";
  if (plan === "pro") { next(); return; }

  const userId = req.userId;
  if (!userId) { next(); return; }

  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const current = getApiKeyCount(userId);
  const blocked = current >= limits.apiKeys;

  console.log(`[rate-limit] type=key userId=${userId} plan=${plan} current=${current} limit=${limits.apiKeys} blocked=${blocked}`);

  if (blocked) {
    res.status(403).json(getRateLimitResponse("api_key_limit", limits.apiKeys, current));
    return;
  }

  next();
}
