import { createHmac, timingSafeEqual } from "node:crypto";
import { decryptExchangeCredential, encryptExchangeCredential } from "./exchange-credentials";
import type { EncryptedCredential } from "./exchange-credentials";

type PaystackEnvelope<T> = { status: boolean; data?: T };

export type PaystackTransaction = {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at: string | null;
  customer?: { email?: string };
  subscription?: { subscription_code?: string };
  metadata?: { userId?: string; planId?: string };
};

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  return key;
}

async function requestPaystack<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
    redirect: "error",
  });
  let envelope: PaystackEnvelope<T>;
  try {
    envelope = await response.json() as PaystackEnvelope<T>;
  } catch {
    throw new Error("Paystack returned an invalid response.");
  }
  if (!response.ok || envelope.status !== true || envelope.data === undefined) {
    throw new Error(`Paystack request failed (HTTP ${response.status}).`);
  }
  return envelope.data;
}

export function paystackPlanCode(planId: string): string {
  const envKey = planId === "starter" ? "PAYSTACK_STARTER_PLAN_CODE"
    : planId === "professional" ? "PAYSTACK_PROFESSIONAL_PLAN_CODE" : "";
  const code = envKey ? process.env[envKey] : undefined;
  if (!code) throw new Error(`Paystack monthly plan code is not configured for ${planId}.`);
  return code;
}

export async function initializePaystackTransaction(input: {
  email: string;
  planId: string;
  amountMinor: number;
  reference: string;
  callbackUrl: string;
  userId: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const planCode = paystackPlanCode(input.planId);
  const configuredPlan = await requestPaystack<{
    plan_code: string;
    amount: number;
    currency: string;
    interval: string;
  }>(`/plan/${encodeURIComponent(planCode)}`);
  if (configuredPlan.plan_code !== planCode || configuredPlan.amount !== input.amountMinor ||
      configuredPlan.currency !== "NGN" || configuredPlan.interval !== "monthly") {
    throw new Error(`Paystack plan configuration does not match the ${input.planId} monthly price.`);
  }
  const data = await requestPaystack<{ authorization_url: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      reference: input.reference,
      plan: planCode,
      callback_url: input.callbackUrl,
      metadata: { userId: input.userId, planId: input.planId },
    }),
  });
  const authorizationUrl = new URL(data.authorization_url);
  if (authorizationUrl.protocol !== "https:" ||
      (authorizationUrl.hostname !== "paystack.com" && !authorizationUrl.hostname.endsWith(".paystack.com"))) {
    throw new Error("Paystack returned an unexpected checkout URL.");
  }
  if (data.reference !== input.reference) throw new Error("Paystack returned a mismatched payment reference.");
  return { authorizationUrl: authorizationUrl.toString(), reference: data.reference };
}

export async function verifyPaystackTransaction(reference: string): Promise<PaystackTransaction> {
  return requestPaystack<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

export function encryptPaystackEmailToken(token: string, userId: string): EncryptedCredential {
  return encryptExchangeCredential(token, `paystack-subscription:${userId}`);
}

export function decryptPaystackEmailToken(encrypted: EncryptedCredential, userId: string): string {
  return decryptExchangeCredential(encrypted, `paystack-subscription:${userId}`);
}

export async function setPaystackSubscriptionEnabled(input: {
  subscriptionCode: string;
  emailToken: string;
  enabled: boolean;
}): Promise<void> {
  await requestPaystack(input.enabled ? "/subscription/enable" : "/subscription/disable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: input.subscriptionCode, token: input.emailToken }),
  });
}

export function verifyPaystackWebhookSignature(rawBody: string, suppliedSignature: string | null): boolean {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !suppliedSignature || !/^[a-f0-9]{128}$/i.test(suppliedSignature)) return false;
  const expected = createHmac("sha512", key).update(rawBody, "utf8").digest();
  const supplied = Buffer.from(suppliedSignature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
