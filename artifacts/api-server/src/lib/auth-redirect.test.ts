import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminAuthorizationFailureRedirect,
  getCallbackFailureRedirect,
  getSafeReturnTo,
} from "./auth-redirect.js";

test("accepts normal and base-prefixed application paths", () => {
  assert.equal(getSafeReturnTo("/admin"), "/admin");
  assert.equal(
    getSafeReturnTo("/wealthone-expenses/admin?tab=requests#pending"),
    "/wealthone-expenses/admin?tab=requests#pending",
  );
});

test("rejects absolute and protocol-relative return targets", () => {
  assert.equal(getSafeReturnTo("https://attacker.example"), "/");
  assert.equal(getSafeReturnTo("//attacker.example"), "/");
});

test("rejects browser-normalized backslash redirect targets", () => {
  assert.equal(getSafeReturnTo("/\\attacker.example"), "/");
  assert.equal(getSafeReturnTo("/\\\\attacker.example/path"), "/");
});

test("rejects server routes that would restart the login flow", () => {
  assert.equal(getSafeReturnTo("/api/login"), "/");
  assert.equal(getSafeReturnTo("/api/login?returnTo=%2Fapi%2Flogin"), "/");
  assert.equal(getSafeReturnTo("/api"), "/");
  assert.equal(getSafeReturnTo("/apiary"), "/apiary");
});

test("rejects empty, non-string, and control-character targets", () => {
  assert.equal(getSafeReturnTo(""), "/");
  assert.equal(getSafeReturnTo(undefined), "/");
  assert.equal(getSafeReturnTo("/admin\nLocation: https://attacker.example"), "/");
});

test("routes failed callbacks to the login flow matching the original intent", () => {
  assert.equal(getCallbackFailureRedirect("user", "/account"), "/api/login");
  assert.equal(
    getCallbackFailureRedirect("admin", "/wealthone-expenses/admin/advice"),
    "/wealthone-expenses/admin/login?error=authentication-failed",
  );
  assert.equal(
    getCallbackFailureRedirect("admin", "/wealthone-expenses/admin?tab=requests"),
    "/wealthone-expenses/admin/login?error=authentication-failed",
  );
  assert.equal(
    getAdminAuthorizationFailureRedirect("/wealthone-expenses/admin/advice"),
    "/wealthone-expenses/admin/login?error=not-authorized",
  );
});

test("admin callback failures cannot use malicious return targets", () => {
  assert.equal(
    getCallbackFailureRedirect("admin", "https://attacker.example"),
    "/admin/login?error=authentication-failed",
  );
  assert.equal(
    getCallbackFailureRedirect("admin", "//attacker.example"),
    "/admin/login?error=authentication-failed",
  );
});
