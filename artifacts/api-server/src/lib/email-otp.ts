import crypto from "crypto";
import { getEnv } from "./env.js";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;
export const OTP_MAX_REQUESTS_PER_NETWORK = 20;
export const EMAIL_DELIVERY_BUDGET_MS = 8_000;
export const EMAIL_DELIVERY_ATTEMPT_TIMEOUT_MS = 3_000;
export const EMAIL_DELIVERY_MAX_ATTEMPTS = 3;

export function normalizeOtpEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidOtpEmail(email: string): boolean {
  if (!email || email.length > 254 || email.includes("..")) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".")) return false;
  if (domain.length > 253 || !domain.includes(".")) return false;
  return domain.split(".").every(
    (label) => label.length > 0
      && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

export function hasMultipleOtpEmailAddresses(email: string): boolean {
  return (email.match(/@/g) ?? []).length > 1 || /[,;\s]/.test(email);
}
export function createOtpCode(challengeId: string): string {
  const value = Number.parseInt(keyedHash(`code:${challengeId}`).slice(0, 12), 16);
  return (value % 1_000_000).toString().padStart(6, "0");
}

export function hashOtp(challengeId: string, code: string): string {
  return keyedHash(`${challengeId}:${code}`);
}

export function hashRequester(value: string): string {
  return keyedHash(`requester:${value}`);
}

function keyedHash(value: string): string {
  const secret = getEnv("SESSION_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export type EmailDeliveryFailure =
  | "configuration"
  | "sender"
  | "quota"
  | "recipient"
  | "transient";
export class EmailDeliveryError extends Error {
  constructor(
    public readonly category: EmailDeliveryFailure,
    public readonly providerStatus?: number,
    public readonly providerType?: string,
    public readonly indeterminate = false,
  ) {
    super("Email delivery failed");
    this.name = "EmailDeliveryError";
  }
}

export async function sendLoginCode(email: string, code: string, challengeId: string): Promise<void> {
  const apiKey = getEnv("RESEND_API_KEY");
  const from = getEnv("AUTH_EMAIL_FROM");
  if (!apiKey || !from) throw new EmailDeliveryError("configuration");

  const request = {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `login-otp-${challengeId}`,
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${code} is your ezyRetire sign-in code`,
      text: `Your ezyRetire sign-in code is ${code}. It expires in 10 minutes and can be used only once. If you did not request this code, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;color:#17211b"><h1 style="font-family:Georgia,serif">ezyRetire</h1><p>Use this code to securely sign in:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes and can be used only once.</p><p style="color:#68736c;font-size:13px">If you did not request this code, you can ignore this email.</p></div>`,
    }),
  } satisfies RequestInit;

  const deliveryDeadline = Date.now() + EMAIL_DELIVERY_BUDGET_MS;
  for (let attempt = 0; attempt < EMAIL_DELIVERY_MAX_ATTEMPTS; attempt += 1) {
    const remainingMs = deliveryDeadline - Date.now();
    if (remainingMs <= 0) {
      throw new EmailDeliveryError("transient", undefined, undefined, true);
    }
    let response: globalThis.Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        ...request,
        signal: AbortSignal.timeout(Math.min(EMAIL_DELIVERY_ATTEMPT_TIMEOUT_MS, remainingMs)),
      });
    } catch {
      if (attempt < EMAIL_DELIVERY_MAX_ATTEMPTS - 1 && Date.now() < deliveryDeadline) continue;
      throw new EmailDeliveryError("transient", undefined, undefined, true);
    }
    if (response.ok) return;

    let providerType: string | undefined;
    try {
      const body = await response.json() as { name?: unknown };
      if (typeof body.name === "string" && /^[a-z0-9_]{1,80}$/.test(body.name)) providerType = body.name;
    } catch {
      // The HTTP status still provides a safe classification when the response is not JSON.
    }
    if (response.status >= 500 && attempt === 0) continue;
    if (response.status === 409 && providerType === "concurrent_idempotent_requests") {
      if (attempt < EMAIL_DELIVERY_MAX_ATTEMPTS - 1) {
        const retryDelayMs = Math.min(250 * (attempt + 1), deliveryDeadline - Date.now());
        if (retryDelayMs <= 0) {
          throw new EmailDeliveryError("transient", response.status, providerType, true);
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      throw new EmailDeliveryError("transient", response.status, providerType, true);
    }
    const category = classifyResendFailure(response.status, providerType);
    throw new EmailDeliveryError(
      category,
      response.status,
      providerType,
      category === "transient" && response.status >= 500,
    );
  }
}

export function classifyResendFailure(status: number, providerType?: string): EmailDeliveryFailure {
  if (
    providerType === "daily_quota_exceeded"
    || providerType === "monthly_quota_exceeded"
    || providerType === "rate_limit_exceeded"
    || status === 429
  ) {
    return "quota";
  }
  if (
    providerType === "missing_api_key"
    || providerType === "invalid_api_key"
    || providerType === "restricted_api_key"
    || providerType === "invalid_permission"
    || providerType === "suspended_api_key"
    || providerType === "invalid_idempotency_key"
    || providerType === "invalid_idempotent_request"
    || providerType === "invalid_parameter"
    || providerType === "missing_required_field"
    || providerType === "missing_required_parameter"
    || status === 401
  ) {
    return "configuration";
  }
  if (status === 403 || (status === 403 && providerType === "validation_error")) return "sender";
  if (providerType === "invalid_recipient" || providerType === "invalid_to_address") return "recipient";
  if (status === 400 || status === 422) return "configuration";
  return "transient";
}
