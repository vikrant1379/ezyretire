import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhatsAppSupportUrl,
  normalizeWhatsAppNumber,
  WHATSAPP_SUPPORT_MESSAGE,
} from "./whatsapp-support.js";

test("normalizes international WhatsApp numbers while preserving the country code", () => {
  assert.equal(normalizeWhatsAppNumber("+91 99999-99999"), "+919999999999");
  assert.equal(normalizeWhatsAppNumber(" +1 (202) 555-0123 "), "+12025550123");
});

test("rejects missing country codes and malformed numbers", () => {
  assert.equal(normalizeWhatsAppNumber("9876543210"), null);
  assert.equal(normalizeWhatsAppNumber("+0123456789"), null);
  assert.equal(normalizeWhatsAppNumber("+91 support"), null);
  assert.equal(normalizeWhatsAppNumber("+123"), null);
  assert.equal(normalizeWhatsAppNumber(""), null);
});

test("builds a wa.me destination containing only the generic support message", () => {
  assert.equal(
    WHATSAPP_SUPPORT_MESSAGE,
    "Hello ezyRetire support, I need help using my account.",
  );
  assert.equal(
    buildWhatsAppSupportUrl("+91 99999 99999"),
    `https://wa.me/919999999999?text=${encodeURIComponent(WHATSAPP_SUPPORT_MESSAGE)}`,
  );
  assert.equal(buildWhatsAppSupportUrl("9999999999"), null);
});