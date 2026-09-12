import assert from "node:assert/strict";
import test from "node:test";
import { isValidOptionalPhone, normalizeOptionalPhone } from "./auth-profile-input.js";

test("blank and omitted onboarding phone values normalize to null", () => {
  assert.equal(normalizeOptionalPhone(undefined), null);
  assert.equal(normalizeOptionalPhone("   "), null);
  assert.equal(isValidOptionalPhone(normalizeOptionalPhone("")), true);
});

test("supplied onboarding phone values retain the existing minimum validity rule", () => {
  assert.equal(isValidOptionalPhone(normalizeOptionalPhone("+91 9876543210")), true);
  assert.equal(isValidOptionalPhone(normalizeOptionalPhone("123-45")), false);
});