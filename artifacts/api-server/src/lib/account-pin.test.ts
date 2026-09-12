import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccountPinHash,
  DUMMY_ACCOUNT_PIN_HASH,
  isValidAccountPin,
  verifyAccountPin,
} from "./account-pin.js";

test("account PINs accept exactly four ASCII digits", () => {
  assert.equal(isValidAccountPin("0123"), true);
  assert.equal(isValidAccountPin("123"), false);
  assert.equal(isValidAccountPin("12345"), false);
  assert.equal(isValidAccountPin("12a3"), false);
});

test("account PIN hashes are salted and verify without exposing the PIN", async () => {
  const first = await createAccountPinHash("4826");
  const second = await createAccountPinHash("4826");
  assert.notEqual(first, second);
  assert.equal(first.includes("4826"), false);
  assert.equal(await verifyAccountPin("4826", first), true);
  assert.equal(await verifyAccountPin("4827", first), false);
});

test("the dummy verifier follows the same constant-work verification path", async () => {
  assert.equal(await verifyAccountPin("0000", DUMMY_ACCOUNT_PIN_HASH), true);
  assert.equal(await verifyAccountPin("9999", DUMMY_ACCOUNT_PIN_HASH), false);
});