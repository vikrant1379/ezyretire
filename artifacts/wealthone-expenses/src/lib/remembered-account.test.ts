import assert from "node:assert/strict";
import test from "node:test";
import {
  forgetRememberedAccount,
  readRememberedAccount,
  rememberAccount,
} from "./remembered-account.ts";

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    },
  });
}

test("remembered account stores only the normalized sign-in hint", () => {
  installLocalStorage();
  rememberAccount({ email: "  USER@Example.COM ", fullName: "  Vikrant Chaudhary  " });
  assert.deepEqual(readRememberedAccount(), {
    email: "user@example.com",
    fullName: "Vikrant Chaudhary",
  });
  forgetRememberedAccount();
  assert.equal(readRememberedAccount(), null);
});

test("invalid remembered account data is ignored", () => {
  installLocalStorage();
  window.localStorage.setItem("ezyretire:remembered-account:v1", JSON.stringify({
    email: "not-an-email",
    fullName: "",
    pin: "1234",
  }));
  assert.equal(readRememberedAccount(), null);
});

test("blocked browser storage does not interrupt account sign-in or switching", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => {
          throw new DOMException("Storage is blocked", "SecurityError");
        },
        setItem: () => {
          throw new DOMException("Storage quota exceeded", "QuotaExceededError");
        },
        removeItem: () => {
          throw new DOMException("Storage is blocked", "SecurityError");
        },
      },
    },
  });

  assert.equal(readRememberedAccount(), null);
  assert.doesNotThrow(() =>
    rememberAccount({ email: "user@example.com", fullName: "Responsive User" }),
  );
  assert.doesNotThrow(() => forgetRememberedAccount());
});