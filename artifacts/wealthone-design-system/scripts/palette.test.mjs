import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tokens = JSON.parse(readFileSync(new URL("../tokens.json", import.meta.url), "utf8"));
const luminance = (hex) => {
  const channels = hex.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16) / 255)
    .map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
};
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};
for (const theme of ["light", "dark"]) {
  const palette = Object.fromEntries(Object.entries(tokens.color[theme]).map(([key, value]) => [key, value.$value]));
  test(`${theme}: text and financial roles meet AA`, () => {
    for (const surface of ["background", "card", "muted", "secondary"]) {
      for (const text of ["foreground", "mutedForeground", "primary", "positive", "negative", "warning"]) {
        assert.ok(contrast(palette[text], palette[surface]) >= 4.5, `${text} on ${surface}`);
      }
    }
    for (const role of ["primary", "secondary", "destructive", "support"]) {
      assert.ok(contrast(palette[role], palette[`${role}Foreground`]) >= 4.5, role);
    }
    for (const role of ["positive", "negative", "warning"]) {
      assert.ok(contrast(palette[role], palette[`${role}Background`]) >= 4.5, role);
    }
  });
  test(`${theme}: controls and focus have visible boundaries`, () => {
    for (const surface of ["background", "card", "muted", "secondary"]) {
      for (const role of ["input", "ring", "sidebarRing"]) {
        assert.ok(contrast(palette[role], palette[surface]) >= 3, `${role} on ${surface}`);
      }
    }
    assert.equal(palette.ring, palette.primary);
    assert.equal(palette.support, palette.primary);
    assert.equal(new Set(["primary", "positive", "negative", "warning"].map((role) => palette[role])).size, 4);
  });
}
test("headings and body share Inter without a decorative family", () => {
  assert.deepEqual(tokens.typography.fontFamily.serif.$value, tokens.typography.fontFamily.sans.$value);
  assert.equal(tokens.typography.fontFamily.sans.$value[0], "Inter");
});