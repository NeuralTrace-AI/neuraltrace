import crypto from "node:crypto";
import { Request, Response } from "express";
import {
  upsertOAuthClient,
  findOAuthClient,
  storeOAuthCode,
  findOAuthCode,
  markOAuthCodeUsed,
  storeOAuthToken,
  findOAuthToken,
  findOAuthTokenByRefresh,
  revokeOAuthToken,
} from "./database.js";
import { verifyJwt } from "./auth.js";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// ─── Discovery Endpoint ───
// GET /.well-known/oauth-authorization-server

export function handleOAuthDiscovery(_req: Request, res: Response): void {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    revocation_endpoint: `${BASE_URL}/oauth/revoke`,
    registration_endpoint: `${BASE_URL}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["vault"],
  });
}

// ─── Dynamic Client Registration ───
// POST /oauth/register

export function handleClientRegistration(req: Request, res: Response): void {
  const { client_name, redirect_uris } = req.body || {};

  const clientId = `ntclient_${crypto.randomBytes(16).toString("hex")}`;
  const uris = Array.isArray(redirect_uris) ? redirect_uris : [];

  upsertOAuthClient(clientId, client_name || "Unknown Client", uris);
  console.log(`[OAuth] Client registered: ${clientId} (${client_name || "Unknown"})`);

  res.status(201).json({
    client_id: clientId,
    client_name: client_name || "Unknown Client",
    redirect_uris: uris,
  });
}

// ─── Authorization Endpoint ───
// GET /oauth/authorize

export function handleAuthorize(req: Request, res: Response): void {
  const {
    client_id,
    redirect_uri,
    response_type,
    code_challenge,
    code_challenge_method,
    state,
    scope,
  } = req.query as Record<string, string>;

  // Validate required params
  if (!client_id || !redirect_uri || response_type !== "code" || !code_challenge) {
    res.status(400).send(errorPage("Missing required parameters (client_id, redirect_uri, response_type=code, code_challenge)."));
    return;
  }

  if (code_challenge_method && code_challenge_method !== "S256") {
    res.status(400).send(errorPage("Only S256 code_challenge_method is supported."));
    return;
  }

  // Auto-register client if not known (dynamic registration)
  let client = findOAuthClient(client_id);
  if (!client) {
    upsertOAuthClient(client_id, "Auto-registered", [redirect_uri]);
    client = findOAuthClient(client_id);
  }

  // Check for user session (JWT in cookie)
  const sessionJwt = req.cookies?.nt_session;
  const user = sessionJwt ? verifyJwt(sessionJwt) : null;

  if (!user) {
    // Not logged in → show login form
    const returnUrl = req.originalUrl;
    res.send(loginPage(returnUrl));
    return;
  }

  // User is logged in → show consent screen
  res.send(consentPage(client_id, client?.client_name || "An AI application", redirect_uri, code_challenge, state || "", scope || "vault", user.email));
}

// ─── Consent Approval ───
// POST /oauth/approve

export function handleApprove(req: Request, res: Response): void {
  const { client_id, redirect_uri, code_challenge, state, scope, action } = req.body;

  // Check user session
  const sessionJwt = req.cookies?.nt_session;
  const user = sessionJwt ? verifyJwt(sessionJwt) : null;

  if (!user) {
    res.status(401).send(errorPage("Session expired. Please try connecting again."));
    return;
  }

  if (action === "deny") {
    const denyUrl = `${redirect_uri}?error=access_denied${state ? `&state=${state}` : ""}`;
    res.redirect(denyUrl);
    return;
  }

  // Generate auth code
  const code = crypto.randomBytes(32).toString("hex");
  storeOAuthCode(code, client_id, user.userId, redirect_uri, code_challenge);

  const approveUrl = `${redirect_uri}${redirect_uri.includes("?") ? "&" : "?"}code=${code}${state ? `&state=${state}` : ""}`;
  console.log(`[OAuth] Code issued for user ${user.userId} → client ${client_id}`);
  res.redirect(approveUrl);
}

// ─── Login Handler (for OAuth flow) ───
// POST /oauth/login

export async function handleOAuthLogin(req: Request, res: Response): Promise<void> {
  // This uses the existing magic link flow but sets a session cookie for OAuth
  const { email, token, return_url } = req.body;

  if (token) {
    // Verify magic link token
    const { validateMagicToken } = await import("./auth.js");
    const result = validateMagicToken(token);
    if (!result) {
      res.send(loginPage(return_url || "/", "Invalid or expired code. Please try again."));
      return;
    }

    // Find or create user
    const { findUserByEmail, createUser } = await import("./database.js");
    let user = findUserByEmail(result.email);
    if (!user) {
      user = createUser(result.email);
      console.log(`[OAuth] New user created during OAuth: ${user.email} (${user.id})`);
    }

    // Sign JWT and set as cookie
    const { signJwt } = await import("./auth.js");
    const jwtToken = signJwt({ userId: user.id, email: user.email, plan: user.plan });

    res.cookie("nt_session", jwtToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Redirect back to authorize
    res.redirect(return_url || "/");
    return;
  }

  if (email) {
    // Send OAuth-specific magic link that returns to the OAuth flow
    const { generateMagicToken } = await import("./auth.js");
    const rawToken = generateMagicToken(email);
    const returnUrl = req.body.return_url || "/";

    try {
      await sendOAuthMagicLink(email, rawToken, returnUrl);
    } catch (err) {
      res.send(loginPage(returnUrl, "Failed to send email. Please try again."));
      return;
    }

    // Show "check your email" page with token input
    res.send(otpPage(email, returnUrl));
    return;
  }

  res.status(400).send(errorPage("Email required."));
}

// ─── Token Endpoint ───
// POST /oauth/token

export function handleToken(req: Request, res: Response): void {
  const { grant_type, code, redirect_uri, client_id, code_verifier, refresh_token } = req.body;

  if (grant_type === "authorization_code") {
    if (!code || !redirect_uri || !client_id || !code_verifier) {
      res.status(400).json({ error: "invalid_request", error_description: "Missing required parameters" });
      return;
    }

    const codeRow = findOAuthCode(code);
    if (!codeRow) {
      res.status(400).json({ error: "invalid_grant", error_description: "Invalid authorization code" });
      return;
    }
    if (codeRow.used) {
      res.status(400).json({ error: "invalid_grant", error_description: "Code already used" });
      return;
    }
    if (new Date(codeRow.expires_at) < new Date()) {
      res.status(400).json({ error: "invalid_grant", error_description: "Code expired" });
      return;
    }
    if (codeRow.client_id !== client_id) {
      res.status(400).json({ error: "invalid_grant", error_description: "Client mismatch" });
      return;
    }
    if (codeRow.redirect_uri !== redirect_uri) {
      res.status(400).json({ error: "invalid_grant", error_description: "Redirect URI mismatch" });
      return;
    }

    // Verify PKCE
    const verifierHash = crypto.createHash("sha256").update(code_verifier).digest("base64url");
    if (verifierHash !== codeRow.code_challenge) {
      res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      return;
    }

    // Mark code as used
    markOAuthCodeUsed(code);

    // Generate tokens
    const accessToken = `ntoauth_${crypto.randomBytes(32).toString("hex")}`;
    const refreshTokenVal = `ntrefresh_${crypto.randomBytes(32).toString("hex")}`;
    const accessHash = hashToken(accessToken);
    const refreshHash = hashToken(refreshTokenVal);
    const accessExpires = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour
    const refreshExpires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(); // 30 days

    storeOAuthToken(accessHash, client_id, codeRow.user_id, accessExpires, refreshHash, refreshExpires);
    console.log(`[OAuth] Tokens issued for user ${codeRow.user_id} → client ${client_id}`);

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshTokenVal,
      scope: "vault",
    });
    return;
  }

  if (grant_type === "refresh_token") {
    if (!refresh_token || !client_id) {
      res.status(400).json({ error: "invalid_request", error_description: "Missing refresh_token or client_id" });
      return;
    }

    const refreshHash = hashToken(refresh_token);
    const tokenRow = findOAuthTokenByRefresh(refreshHash);

    if (!tokenRow) {
      res.status(400).json({ error: "invalid_grant", error_description: "Invalid refresh token" });
      return;
    }
    if (tokenRow.revoked) {
      res.status(400).json({ error: "invalid_grant", error_description: "Token revoked" });
      return;
    }
    if (new Date(tokenRow.refresh_expires_at) < new Date()) {
      res.status(400).json({ error: "invalid_grant", error_description: "Refresh token expired" });
      return;
    }

    // Revoke old tokens
    revokeOAuthToken(tokenRow.token_hash);

    // Issue new tokens
    const newAccessToken = `ntoauth_${crypto.randomBytes(32).toString("hex")}`;
    const newRefreshToken = `ntrefresh_${crypto.randomBytes(32).toString("hex")}`;
    const newAccessHash = hashToken(newAccessToken);
    const newRefreshHash = hashToken(newRefreshToken);
    const accessExpires = new Date(Date.now() + 3600 * 1000).toISOString();
    const refreshExpires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    storeOAuthToken(newAccessHash, client_id, tokenRow.user_id, accessExpires, newRefreshHash, refreshExpires);
    console.log(`[OAuth] Tokens refreshed for user ${tokenRow.user_id}`);

    res.json({
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: "vault",
    });
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type" });
}

// ─── Revoke Endpoint ───
// POST /oauth/revoke

export function handleRevoke(req: Request, res: Response): void {
  const { token } = req.body;
  if (token) {
    const tokenHash = hashToken(token);
    revokeOAuthToken(tokenHash);
    console.log(`[OAuth] Token revoked`);
  }
  // Always return 200 per RFC 7009
  res.status(200).json({});
}

// ─── OAuth Token Validation ───

export function validateOAuthToken(rawToken: string): string | null {
  const tokenHash = hashToken(rawToken);
  const row = findOAuthToken(tokenHash);
  if (!row) return null;
  if (row.revoked) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row.user_id;
}

// ─── Helpers ───

async function sendOAuthMagicLink(email: string, rawToken: string, returnUrl: string): Promise<void> {
  const nodemailer = await import("nodemailer");
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT) || 465;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass) {
    throw new Error("SMTP not configured");
  }

  // OAuth magic link redirects back to /oauth/login with token + return_url
  const verifyUrl = `${BASE_URL}/oauth/login?token=${rawToken}&return_url=${encodeURIComponent(returnUrl)}`;

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.sendMail({
    from: `"NeuralTrace" <${smtpFrom}>`,
    to: email,
    subject: "Sign in to NeuralTrace",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;color:#1a1a2e;">
<div style="text-align:center;margin-bottom:32px;">
<h1 style="font-size:24px;font-weight:700;color:#E8614D;margin:0;">NeuralTrace</h1>
<p style="color:#666;margin-top:4px;font-size:14px;">Your AI should never forget who you are.</p>
</div>
<div style="background:#f8f9fa;border-radius:12px;padding:32px;text-align:center;">
<p style="font-size:16px;margin-bottom:24px;">Click below to connect your vault:</p>
<a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#E8614D,#D94B7A);color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:16px;">Connect my vault</a>
<p style="color:#999;font-size:12px;margin-top:24px;">This link expires in 15 minutes.</p>
</div>
<p style="color:#ccc;font-size:11px;text-align:center;margin-top:32px;">NeuralTrace — One vault. Every AI.</p>
</body></html>`,
  });

  console.log(`[OAuth] Magic link sent to ${email}`);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function errorPage(message: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NeuralTrace</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0f;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;">
<div style="max-width:400px;text-align:center;padding:40px;">
<h1 style="color:#E8614D;font-size:20px;">Error</h1>
<p style="color:#999;">${message}</p>
</div></body></html>`;
}

function loginPage(returnUrl: string, error?: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — NeuralTrace</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0f;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;">
<div style="max-width:400px;width:100%;padding:40px;">
<h1 style="text-align:center;font-size:24px;margin-bottom:4px;">NeuralTrace</h1>
<p style="text-align:center;color:#999;margin-bottom:32px;">Sign in to connect your vault</p>
${error ? `<p style="color:#E8614D;text-align:center;margin-bottom:16px;">${error}</p>` : ""}
<form method="POST" action="/oauth/login">
<input type="hidden" name="return_url" value="${returnUrl}">
<input type="email" name="email" required placeholder="you@email.com" style="width:100%;padding:12px;background:#16161d;border:1px solid #333;border-radius:8px;color:#e0e0e0;font-size:16px;margin-bottom:12px;box-sizing:border-box;">
<button type="submit" style="width:100%;padding:12px;background:linear-gradient(135deg,#E8614D,#D94B7A);border:none;border-radius:8px;color:white;font-size:16px;font-weight:600;cursor:pointer;">Send sign-in code</button>
</form>
</div></body></html>`;
}

function otpPage(email: string, returnUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Check your email — NeuralTrace</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0f;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;">
<div style="max-width:400px;width:100%;padding:40px;">
<h1 style="text-align:center;font-size:24px;margin-bottom:4px;">Check your email</h1>
<p style="text-align:center;color:#999;margin-bottom:32px;">We sent a sign-in link to <strong>${email}</strong></p>
<p style="text-align:center;color:#666;font-size:14px;">Click the link in the email, then return here.</p>
<form method="POST" action="/oauth/login" style="margin-top:24px;">
<input type="hidden" name="return_url" value="${returnUrl}">
<input type="hidden" name="email" value="${email}">
<input type="text" name="token" placeholder="Or paste your sign-in code" style="width:100%;padding:12px;background:#16161d;border:1px solid #333;border-radius:8px;color:#e0e0e0;font-size:16px;margin-bottom:12px;box-sizing:border-box;">
<button type="submit" style="width:100%;padding:12px;background:#16161d;border:1px solid #333;border-radius:8px;color:#e0e0e0;font-size:14px;cursor:pointer;">Verify code</button>
</form>
</div></body></html>`;
}

function consentPage(clientId: string, clientName: string, redirectUri: string, codeChallenge: string, state: string, scope: string, userEmail: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize — NeuralTrace</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0f;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;">
<div style="max-width:400px;width:100%;padding:40px;">
<h1 style="text-align:center;font-size:24px;margin-bottom:4px;">NeuralTrace</h1>
<p style="text-align:center;color:#999;margin-bottom:32px;">Authorize access to your vault</p>
<div style="background:#16161d;border-radius:12px;padding:24px;margin-bottom:24px;">
<p style="margin:0 0 12px;font-size:16px;"><strong>${clientName}</strong> wants to access your NeuralTrace vault.</p>
<p style="margin:0 0 8px;color:#999;font-size:14px;">This will allow it to:</p>
<ul style="color:#999;font-size:14px;margin:0;padding-left:20px;">
<li>Search your saved memories</li>
<li>Save new memories to your vault</li>
<li>Delete memories from your vault</li>
</ul>
<p style="margin:16px 0 0;color:#666;font-size:12px;">Signed in as ${userEmail}</p>
</div>
<form method="POST" action="/oauth/approve">
<input type="hidden" name="client_id" value="${clientId}">
<input type="hidden" name="redirect_uri" value="${redirectUri}">
<input type="hidden" name="code_challenge" value="${codeChallenge}">
<input type="hidden" name="state" value="${state}">
<input type="hidden" name="scope" value="${scope}">
<button type="submit" name="action" value="approve" style="width:100%;padding:12px;background:linear-gradient(135deg,#E8614D,#D94B7A);border:none;border-radius:8px;color:white;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:8px;">Allow</button>
<button type="submit" name="action" value="deny" style="width:100%;padding:12px;background:none;border:1px solid #333;border-radius:8px;color:#999;font-size:14px;cursor:pointer;">Deny</button>
</form>
</div></body></html>`;
}
