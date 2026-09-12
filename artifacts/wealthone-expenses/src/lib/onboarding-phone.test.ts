import assert from "node:assert/strict";
import test from "node:test";
import { getOptionalOnboardingPhoneError } from "./onboarding-phone.ts";

test("blank onboarding phone values are valid", () => {
  assert.equal(getOptionalOnboardingPhoneError(""), undefined);
  assert.equal(getOptionalOnboardingPhoneError("   "), undefined);
});

test("malformed supplied onboarding phone values are rejected", () => {
  assert.equal(getOptionalOnboardingPhoneError("123-45"), "Enter a valid mobile number");
  assert.equal(getOptionalOnboardingPhoneError("+91 9876543210"), undefined);
});