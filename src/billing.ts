import { type Request, type Response } from "express";
import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import { findUserById, getSystemDb } from "./database.js";

// ─── Paddle SDK (lazy init) ───

let paddleClient: Paddle | null | undefined; // undefined = not yet checked

function getPaddleClient(): Paddle | null {
  if (paddleClient !== undefined) return paddleClient;

  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) {
    paddleClient = null;
    return null;
  }

  const env = process.env.PADDLE_ENVIRONMENT === "production"
    ? Environment.production
    : Environment.sandbox;

  paddleClient = new Paddle(apiKey, { environment: env });
  console.log(`[billing] Paddle SDK initialized (${env})`);
  return paddleClient;
}

function getWebhookSecret(): string | null {
  return process.env.PADDLE_WEBHOOK_SECRET || null;
}

// ─── Plan Update (atomic) ───

export function updateUserPlan(
  userId: string,
  plan: string,
  paddleCustomerId: string,
  paddleSubscriptionId: string
): boolean {
  const sdb = getSystemDb();
  const now = new Date().toISOString();
  const result = sdb.prepare(
    "UPDATE users SET plan = ?, paddle_customer_id = ?, paddle_subscription_id = ?, updated_at = ? WHERE id = ?"
  ).run(plan, paddleCustomerId, paddleSubscriptionId, now, userId);

  if (result.changes > 0) {
    console.log(
      `[billing] event=plan_updated userId=${userId} plan=${plan} paddleCustomerId=${paddleCustomerId}`
    );
    return true;
  }

  console.log(`[billing] user-not-found userId=${userId}`);
  return false;
}

// ─── Webhook Handler ───

export async function handleBillingWebhook(req: Request, res: Response): Promise<void> {
  const paddle = getPaddleClient();
  const webhookSecret = getWebhookSecret();

  if (!paddle || !webhookSecret) {
    res.status(501).json({ error: "Billing not configured" });
    return;
  }

  try {
    // express.raw() puts a Buffer in req.body
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf-8") : undefined;
    const signature = req.headers["paddle-signature"] as string | undefined;

    if (!rawBody || !signature) {
      console.log("[billing] error=missing_signature_or_body");
      res.status(401).json({ error: "Missing signature or body" });
      return;
    }

    let event;
    try {
      event = await paddle.webhooks.unmarshal(rawBody, webhookSecret, signature);
    } catch (err: any) {
      console.log(`[billing] error=signature_verification_failed message=${err.message}`);
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const eventType = event.eventType;

    switch (eventType) {
      case "subscription.created":
      case "subscription.updated":
      case "subscription.activated": {
        const data = event.data as any;
        const customData = data.customData as Record<string, string> | null;
        const userId = customData?.userId;
        const paddleCustomerId = data.customerId as string;
        const subscriptionId = data.id as string;

        if (!userId) {
          console.log(`[billing] error=missing_userId event=${eventType} subscriptionId=${subscriptionId}`);
          res.status(200).json({ received: true });
          return;
        }

        updateUserPlan(userId, "pro", paddleCustomerId, subscriptionId);
        console.log(
          `[billing] event=${eventType} userId=${userId} subscriptionId=${subscriptionId}`
        );
        break;
      }

      case "subscription.canceled": {
        const data = event.data as any;
        const customData = data.customData as Record<string, string> | null;
        const userId = customData?.userId;
        const paddleCustomerId = data.customerId as string;
        const subscriptionId = data.id as string;

        if (!userId) {
          console.log(`[billing] error=missing_userId event=${eventType} subscriptionId=${subscriptionId}`);
          res.status(200).json({ received: true });
          return;
        }

        updateUserPlan(userId, "free", paddleCustomerId, subscriptionId);
        console.log(
          `[billing] event=${eventType} userId=${userId} subscriptionId=${subscriptionId}`
        );
        break;
      }

      default:
        console.log(`[billing] ignored event=${eventType}`);
    }

    res.status(200).json({ received: true });
  } catch (err: any) {
    // Always return 200 to Paddle to prevent retries
    console.log(`[billing] error=webhook_processing_failed message=${err.message}`);
    res.status(200).json({ received: true });
  }
}

// ─── Customer Portal Handler ───

export async function handleBillingPortal(req: Request, res: Response): Promise<void> {
  const paddle = getPaddleClient();

  if (!paddle) {
    res.status(501).json({ error: "Billing not configured" });
    return;
  }

  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const user = findUserById(userId);
    if (!user || !user.paddle_customer_id) {
      res.status(400).json({ error: "No billing account found. Please subscribe first." });
      return;
    }

    const subscriptionIds = user.paddle_subscription_id
      ? [user.paddle_subscription_id]
      : [];

    const portalSession = await paddle.customerPortalSessions.create(
      user.paddle_customer_id,
      subscriptionIds
    );

    res.json({ url: portalSession.urls.general.overview });
  } catch (err: any) {
    console.log(`[billing] error=portal_session_failed message=${err.message}`);
    res.status(500).json({ error: "Failed to create billing portal session" });
  }
}
