import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticationCredentialToJSON,
  getWebAuthnErrorMessage,
  parseCreationOptions,
  parseRequestOptions,
} from "./webauthn.ts";

const originalWindow = globalThis.window;

test.before(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    },
  });
});

test.after(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

test("converts creation and request binary fields from base64url", () => {
  const creation = parseCreationOptions({
    challenge: "AQID",
    rp: { name: "ezyRetire" },
    user: { id: "_-4", name: "person@example.com", displayName: "Person" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    excludeCredentials: [{ type: "public-key", id: "BAU" }],
  });
  assert.deepEqual([...new Uint8Array(creation.challenge)], [1, 2, 3]);
  assert.deepEqual([...new Uint8Array(creation.user.id)], [255, 238]);
  assert.deepEqual([...new Uint8Array(creation.excludeCredentials![0].id)], [4, 5]);

  const request = parseRequestOptions({
    challenge: "Bgc",
    allowCredentials: [{ type: "public-key", id: "CAk" }],
  });
  assert.deepEqual([...new Uint8Array(request.challenge)], [6, 7]);
  assert.deepEqual([...new Uint8Array(request.allowCredentials![0].id)], [8, 9]);
});

test("serializes an assertion without padded base64", () => {
  const credential = {
    id: "credential-id",
    rawId: Uint8Array.from([1, 2]).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({ appid: false }),
    response: {
      clientDataJSON: Uint8Array.from([3]).buffer,
      authenticatorData: Uint8Array.from([4]).buffer,
      signature: Uint8Array.from([5]).buffer,
      userHandle: null,
    },
  } as unknown as PublicKeyCredential;
  assert.deepEqual(authenticationCredentialToJSON(credential), {
    id: "credential-id",
    rawId: "AQI",
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: { appid: false },
    response: {
      clientDataJSON: "Aw",
      authenticatorData: "BA",
      signature: "BQ",
      userHandle: null,
    },
  });
});

test("gives cancellation guidance without exposing account details", () => {
  const message = getWebAuthnErrorMessage(
    new DOMException("Browser-specific detail", "NotAllowedError"),
    "sign in",
  );
  assert.equal(
    message,
    "Passkey sign-in was cancelled or timed out. You can try again or use an email code.",
  );
  assert.doesNotMatch(message, /account|email address|credential-id/i);
});