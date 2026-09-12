import crypto from "crypto";
import { getEnv } from "./env.js";
import { EmailDeliveryError } from "./email-otp.js";

export const MOBILE_OTP_TTL_MS = 10 * 60_000;
export const MOBILE_OTP_RESEND_MS = 60_000;
export const MOBILE_OTP_MAX_ATTEMPTS = 5;
export const MOBILE_OTP_MAX_REQUESTS = 10;
export const MOBILE_OTP_WINDOW_MS = 10 * 60_000;

function secretHash(value: string): string {
  const secret = getEnv("SESSION_SECRET");
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}
export function createMobileOtp(challengeId?: string): string {
  if (challengeId) return secretHash(`mobile-code:${challengeId}`).slice(0, 6).replace(/[a-f]/gi, (c) => String(parseInt(c, 16) % 10));
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}
export function hashMobileOtp(id: string, code: string): string {
  return secretHash(`mobile:${id}:${code}`);
}
export function hashMobileRequester(value: string): string {
  return secretHash(`mobile-requester:${value}`);
}

export class MobileDeliveryError extends Error {
  constructor(public readonly indeterminate: boolean) {
    super("SMS delivery failed");
    this.name = "MobileDeliveryError";
  }
}

let verificationSmsSender: ((phone: string, code: string) => Promise<void>) | undefined;

export function setVerificationSmsSenderForTests(
  sender?: (phone: string, code: string) => Promise<void>,
): void {
  verificationSmsSender = sender;
}

export async function sendVerificationSms(phone: string, code: string): Promise<void> {
  if (verificationSmsSender) return verificationSmsSender(phone, code);
  const sid = getEnv("TWILIO_ACCOUNT_SID");
  const token = getEnv("TWILIO_AUTH_TOKEN");
  const from = getEnv("TWILIO_FROM_NUMBER");
  if (!sid || !token || !from) throw new MobileDeliveryError(false);
  let response: Response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: phone, From: from, Body: `${code} is your ezyRetire mobile verification code. It expires in 10 minutes.` }),
    signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new MobileDeliveryError(true);
  }
  if (!response.ok) throw new MobileDeliveryError(false);
}

export async function sendMobileFallbackEmail(email: string, code: string, challengeId: string): Promise<void> {
  const apiKey = getEnv("RESEND_API_KEY");
  const from = getEnv("AUTH_EMAIL_FROM");
  if (!apiKey || !from) throw new EmailDeliveryError("configuration");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `mobile-otp-${challengeId}`,
    },
    body: JSON.stringify({
      from, to: [email], subject: `${code} is your mobile verification code`,
      text: `Your ezyRetire mobile verification code is ${code}. It expires in 10 minutes. Do not share it.`,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new EmailDeliveryError(response.status === 429 ? "quota" : "transient", response.status);
}