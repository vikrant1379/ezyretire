import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyResendFailure,
  EmailDeliveryError,
  hasMultipleOtpEmailAddresses,
  isValidOtpEmail,
  normalizeOtpEmail,
  sendLoginCode,
} from "./email-otp.js";

test("normalizes email identity consistently", () => {
  assert.equal(normalizeOtpEmail("  Person@Example.COM "), "person@example.com");
});

test("accepts normal addresses and rejects malformed or oversized addresses", () => {
  assert.equal(isValidOtpEmail("person@example.com"), true);
  assert.equal(isValidOtpEmail("not-an-email"), false);
  assert.equal(isValidOtpEmail("first@example.comsecond@example.com"), false);
  assert.equal(hasMultipleOtpEmailAddresses("first@example.comsecond@example.com"), true);
  assert.equal(isValidOtpEmail("first@example.com,second@example.com"), false);
  assert.equal(isValidOtpEmail(".person@example.com"), false);
  assert.equal(isValidOtpEmail("person@example..com"), false);
  assert.equal(isValidOtpEmail(`${"a".repeat(310)}@example.com`), false);
});

test("classifies representative Resend failures without provider messages", () => {
  assert.equal(classifyResendFailure(401, "invalid_api_key"), "configuration");
  assert.equal(classifyResendFailure(403, "validation_error"), "sender");
  assert.equal(classifyResendFailure(403, "invalid_permission"), "configuration");
  assert.equal(classifyResendFailure(403, "suspended_api_key"), "configuration");
  assert.equal(classifyResendFailure(429, "rate_limit_exceeded"), "quota");
  assert.equal(classifyResendFailure(422, "validation_error"), "configuration");
  assert.equal(classifyResendFailure(422, "invalid_to_address"), "recipient");
  assert.equal(classifyResendFailure(500, "application_error"), "transient");
});

test("reports missing provider configuration as a configuration failure", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.AUTH_EMAIL_FROM;
  delete process.env.RESEND_API_KEY;
  delete process.env.AUTH_EMAIL_FROM;
  try {
    await assert.rejects(
      sendLoginCode("person@example.com", "123456", "challenge-1"),
      (error: unknown) => error instanceof EmailDeliveryError && error.category === "configuration",
    );
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.AUTH_EMAIL_FROM;
    else process.env.AUTH_EMAIL_FROM = previousFrom;
  }
});

test("classifies a transport failure without retaining sensitive error details", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.AUTH_EMAIL_FROM;
  const nativeFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "test-key";
  process.env.AUTH_EMAIL_FROM = "Login <login@example.test>";
  globalThis.fetch = () => Promise.reject(new Error("sensitive transport details"));
  try {
    await assert.rejects(
      sendLoginCode("person@example.com", "123456", "challenge-2"),
      (error: unknown) =>
        error instanceof EmailDeliveryError
        && error.category === "transient"
        && error.indeterminate
        && error.message === "Email delivery failed",
    );
  } finally {
    globalThis.fetch = nativeFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.AUTH_EMAIL_FROM;
    else process.env.AUTH_EMAIL_FROM = previousFrom;
  }
});

test("retries an indeterminate send with the same provider idempotency key", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.AUTH_EMAIL_FROM;
  const nativeFetch = globalThis.fetch;
  const idempotencyKeys: string[] = [];
  process.env.RESEND_API_KEY = "test-key";
  process.env.AUTH_EMAIL_FROM = "Login <login@example.test>";
  globalThis.fetch = (_input, init) => {
    idempotencyKeys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
    if (idempotencyKeys.length === 1) return Promise.reject(new Error("connection closed after acceptance"));
    return Promise.resolve(new Response(JSON.stringify({ id: "accepted-message" }), { status: 200 }));
  };
  try {
    await sendLoginCode("person@example.com", "123456", "challenge-stable");
    assert.deepEqual(idempotencyKeys, [
      "login-otp-challenge-stable",
      "login-otp-challenge-stable",
    ]);
  } finally {
    globalThis.fetch = nativeFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.AUTH_EMAIL_FROM;
    else process.env.AUTH_EMAIL_FROM = previousFrom;
  }
});

test("does not treat a provider request still in progress as delivered", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.AUTH_EMAIL_FROM;
  const nativeFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "test-key";
  process.env.AUTH_EMAIL_FROM = "Login <login@example.test>";
  globalThis.fetch = () => Promise.resolve(new Response(
    JSON.stringify({ name: "concurrent_idempotent_requests" }),
    { status: 409, headers: { "content-type": "application/json" } },
  ));
  try {
    await assert.rejects(
      sendLoginCode("person@example.com", "123456", "challenge-pending"),
      (error: unknown) =>
        error instanceof EmailDeliveryError
        && error.category === "transient"
        && error.providerType === "concurrent_idempotent_requests"
        && error.indeterminate,
    );
  } finally {
    globalThis.fetch = nativeFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.AUTH_EMAIL_FROM;
    else process.env.AUTH_EMAIL_FROM = previousFrom;
  }
});