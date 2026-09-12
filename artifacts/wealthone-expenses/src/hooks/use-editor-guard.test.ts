import assert from "node:assert/strict";
import test from "node:test";
import { shouldConfirmAnchorNavigation } from "./use-editor-guard.ts";

test("only confirms dirty same-origin document navigation", () => {
  const currentUrl = "https://app.example.test/profile?section=personal";

  assert.equal(
    shouldConfirmAnchorNavigation(true, {
      currentUrl,
      href: "/settings",
    }),
    true,
  );
  assert.equal(
    shouldConfirmAnchorNavigation(true, {
      currentUrl,
      href: "/profile?section=personal#details",
    }),
    false,
  );
  assert.equal(
    shouldConfirmAnchorNavigation(true, {
      currentUrl,
      href: "https://other.example.test/",
    }),
    false,
  );
});

test("does not intercept modified, new-window, download, or clean links", () => {
  const currentUrl = "https://app.example.test/profile?section=personal";
  const destination = "/settings";

  assert.equal(shouldConfirmAnchorNavigation(false, { currentUrl, href: destination }), false);
  assert.equal(shouldConfirmAnchorNavigation(true, { currentUrl, href: destination, modified: true }), false);
  assert.equal(shouldConfirmAnchorNavigation(true, { currentUrl, href: destination, target: "_blank" }), false);
  assert.equal(shouldConfirmAnchorNavigation(true, { currentUrl, href: destination, download: true }), false);
});