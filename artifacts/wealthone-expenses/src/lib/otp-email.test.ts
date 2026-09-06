import assert from "node:assert/strict";
import test from "node:test";
import { getOtpEmailValidationError, normalizeOtpEmail } from "./otp-email.ts";

test("normalizes a single email address", () => {
  assert.equal(normalizeOtpEmail(" Person@Example.COM "), "person@example.com");
  assert.equal(getOtpEmailValidationError(" Person@Example.COM "), null);
});

test("gives focused guidance for accidentally joined addresses", () => {
  assert.match(
    getOtpEmailValidationError("first@example.comsecond@example.com") ?? "",
    /one email address|two addresses/i,
  );
  assert.match(
    getOtpEmailValidationError("first@example.com,second@example.com") ?? "",
    /one email address|two addresses/i,
  );
});

test("rejects other malformed addresses", () => {
  assert.match(getOtpEmailValidationError("not-an-email") ?? "", /valid email/i);
  assert.match(getOtpEmailValidationError("person@example..com") ?? "", /valid email/i);
});