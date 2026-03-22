import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import {
  storeMagicToken,
  findMagicToken,
  markMagicTokenUsed,
  findUserByApiKey,
  touchApiKey,
} from "./database.js";

const JWT_SECRET = process.env.JWT_SECRET || "neuraltrace-dev-secret";
const JWT_EXPIRY = "7d";
const MAGIC_LINK_EXPIRY_MINUTES = 15;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// ─── JWT ───

export interface JwtPayload {
  userId: string;
  email: string;
  plan: string;
}

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// ─── Magic Link ───

/**
 * Generates a magic link token for the given email.
 * Stores SHA-256 hash in DB, returns raw token.
 */
export function generateMagicToken(email: string): string {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(
    Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000
  ).toISOString();
  storeMagicToken(email, tokenHash, expiresAt);
  console.log(`[Auth] Magic token generated for ${email}, expires in ${MAGIC_LINK_EXPIRY_MINUTES}m`);
  return rawToken;
}

/**
 * Validates a magic link token.
 * Returns the email if valid, null if expired/used/invalid.
 */
export function validateMagicToken(rawToken: string): {
  email: string;
  tokenId: string;
} | null {
  const tokenHash = hashToken(rawToken);
  const row = findMagicToken(tokenHash);
  if (!row) {
    console.log("[Auth] Magic token validation failed: not found");
    return null;
  }
  if (row.used) {
    console.log("[Auth] Magic token validation failed: already used");
    return null;
  }
  if (new Date(row.expires_at) < new Date()) {
    console.log("[Auth] Magic token validation failed: expired");
    return null;
  }
  markMagicTokenUsed(row.id);
  console.log(`[Auth] Magic token validated for ${row.email}`);
  return { email: row.email, tokenId: row.id };
}

/**
 * Sends a magic link email via SMTP (nodemailer).
 * Supports Hostinger, Gmail, or any SMTP provider.
 * Required env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * Optional: SMTP_FROM (defaults to SMTP_USER)
 */
export async function sendMagicLink(
  email: string,
  rawToken: string
): Promise<boolean> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT) || 465;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass) {
    throw new Error("SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS.");
  }

  const verifyUrl = `${BASE_URL}/auth/verify?token=${rawToken}`;

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  try {
    await transporter.sendMail({
      from: `"NeuralTrace" <${smtpFrom}>`,
      to: email,
      subject: "Sign in to NeuralTrace",
      html: magicLinkEmailHtml(verifyUrl),
    });

    console.log(`[Auth] Magic link email sent to ${email} via SMTP`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Auth] SMTP error for ${email}:`, msg);
    throw new Error(`Failed to send magic link: ${msg}`);
  }
}

// ─── API Key ───

/**
 * Validates an API key (nt_* prefix).
 * Returns userId if valid, null otherwise.
 */
export function validateApiKey(rawKey: string): string | null {
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const user = findUserByApiKey(keyHash);
  if (!user) return null;
  touchApiKey(keyHash);
  return user.id;
}

// ─── Helpers ───

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function magicLinkEmailHtml(verifyUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 24px; font-weight: 700; color: #6c63ff; margin: 0;">NeuralTrace</h1>
    <p style="color: #666; margin-top: 4px; font-size: 14px;">Your AI should never forget who you are.</p>
  </div>
  <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; text-align: center;">
    <p style="font-size: 16px; margin-bottom: 24px;">Click below to sign in to your NeuralTrace account:</p>
    <a href="${verifyUrl}" style="display: inline-block; background: #6c63ff; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Sign in to NeuralTrace</a>
    <p style="color: #999; font-size: 12px; margin-top: 24px;">This link expires in 15 minutes. If you didn't request this, you can safely ignore it.</p>
  </div>
  <p style="color: #ccc; font-size: 11px; text-align: center; margin-top: 32px;">NeuralTrace — One vault. Every AI.</p>
</body>
</html>`.trim();
}
