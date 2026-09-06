import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import {
  LOGIN_ACTIVITY_RETENTION_DAYS,
  loginActivityRetentionCutoff,
  parseLoginMetadata,
} from "./login-activity.js";

function request(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

test("parses bounded device and approximate geography without storing an IP", () => {
  const metadata = parseLoginMetadata(request({
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
    "x-vercel-ip-country": "in",
    "x-vercel-ip-country-region": "KA",
    "x-vercel-ip-city": "Bengaluru%20Urban",
    "x-forwarded-for": "203.0.113.5",
  }));
  assert.deepEqual(metadata, {
    deviceType: "Mobile",
    browser: "Safari 17.5",
    operatingSystem: "iOS 17.5",
    country: "IN",
    region: "KA",
    city: "Bengaluru Urban",
  });
  assert.equal("ip" in metadata, false);
});

test("missing request metadata remains safely null", () => {
  assert.deepEqual(parseLoginMetadata(request()), {
    deviceType: null,
    browser: null,
    operatingSystem: null,
    country: null,
    region: null,
    city: null,
  });
});

test("retention cutoff is exactly 90 days", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");
  assert.equal(LOGIN_ACTIVITY_RETENTION_DAYS, 90);
  assert.equal(loginActivityRetentionCutoff(now).toISOString(), "2026-06-08T12:00:00.000Z");
});