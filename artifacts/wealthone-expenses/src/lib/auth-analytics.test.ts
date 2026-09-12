import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUTH_FUNNEL_SUCCESS_EVENTS,
  trackAuthFunnelSuccess,
  trackCodeRequestSuccess,
} from "./auth-analytics.ts";

test("authentication success events distinguish initial code requests from resends without personal data", () => {
  const originalWindow = globalThis.window;
  const events: Array<{ name: string; data?: Record<string, unknown> }> = [];
  globalThis.window = {
    umami: {
      track: (name, data) => events.push({ name, data }),
    },
  } as unknown as Window & typeof globalThis;

  try {
    trackCodeRequestSuccess("initial");
    trackCodeRequestSuccess("resend");
    trackAuthFunnelSuccess("verification");
    trackAuthFunnelSuccess("profileCompletion");

    assert.deepEqual(events, [
      {
        name: AUTH_FUNNEL_SUCCESS_EVENTS.codeRequest,
        data: { request_kind: "initial" },
      },
      {
        name: AUTH_FUNNEL_SUCCESS_EVENTS.codeRequest,
        data: { request_kind: "resend" },
      },
      { name: AUTH_FUNNEL_SUCCESS_EVENTS.verification, data: undefined },
      { name: AUTH_FUNNEL_SUCCESS_EVENTS.profileCompletion, data: undefined },
    ]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("analytics failures cannot interrupt authentication", () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    umami: {
      track: () => {
        throw new Error("analytics unavailable");
      },
    },
  } as unknown as Window & typeof globalThis;

  try {
    assert.doesNotThrow(() => trackCodeRequestSuccess("initial"));
    assert.doesNotThrow(() => trackCodeRequestSuccess("resend"));
    assert.doesNotThrow(() => trackAuthFunnelSuccess("verification"));
    assert.doesNotThrow(() => trackAuthFunnelSuccess("profileCompletion"));
  } finally {
    globalThis.window = originalWindow;
  }
});

test("the login journey records each event only after its successful response boundary", async () => {
  const loginSource = await readFile(new URL("../pages/login.tsx", import.meta.url), "utf8");

  assert.match(
    loginSource,
    /if \(!response\.ok \|\| !body\.challengeId\)[\s\S]*?throw new Error[\s\S]*?trackCodeRequestSuccess\(requestKind\)/,
  );
  assert.match(loginSource, /await requestCode\("initial"\)/);
  assert.match(loginSource, /await requestCode\("resend"\)/);
  assert.match(
    loginSource,
    /if \(!response\.ok\) throw new Error[\s\S]*?if \(step === "code"\) \{[\s\S]*?trackAuthFunnelSuccess\("verification"\)/,
  );
  assert.match(
    loginSource,
    /if \(step === "profile"\) \{[\s\S]*?trackAuthFunnelSuccess\("profileCompletion"\)/,
  );
});