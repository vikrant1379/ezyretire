import assert from "node:assert/strict";
import test from "node:test";
import { readAuthResponse } from "./auth-response.ts";

const authStages = [
  ["OTP request", "/api/auth/otp/request"],
  ["OTP verification", "/api/auth/otp/verify"],
  ["profile completion", "/api/auth/profile"],
] as const;

function responseWith(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

for (const [stage, endpoint] of authStages) {
  test(`${stage} shows a clear retry message for an empty ${endpoint} response`, async () => {
    await assert.rejects(
      readAuthResponse(responseWith("")),
      (error: unknown) => {
        assert.equal(
          error instanceof Error ? error.message : "",
          "The sign-in service returned an empty response. Please try again.",
        );
        assert.doesNotMatch(error instanceof Error ? error.message : "", /Unexpected end of JSON input/);
        return true;
      },
    );
  });

  test(`${stage} shows a clear retry message for malformed JSON from ${endpoint}`, async () => {
    await assert.rejects(
      readAuthResponse(responseWith('{"incomplete":')),
      (error: unknown) => {
        assert.equal(
          error instanceof Error ? error.message : "",
          "The sign-in service returned an invalid response. Please try again.",
        );
        assert.doesNotMatch(error instanceof Error ? error.message : "", /JSON|Unexpected end/i);
        return true;
      },
    );
  });
}

test("valid authentication responses keep their successful parsed result", async () => {
  const body = {
    challengeId: "challenge-123",
    resendAfterSeconds: 60,
    user: { fullName: "Test User" },
    needsProfile: false,
  };

  assert.deepEqual(await readAuthResponse(responseWith(JSON.stringify(body))), body);
});