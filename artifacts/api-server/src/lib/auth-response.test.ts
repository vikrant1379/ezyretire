import assert from "node:assert/strict";
import test from "node:test";
import { GetCurrentAuthUserResponse } from "@workspace/api-zod";

test("auth user responses preserve date-only birth dates", () => {
  const dateOfBirth = "1990-01-01";
  const parsed = GetCurrentAuthUserResponse.parse({
    user: {
      id: "user-1",
      email: "user@example.com",
      profileImageUrl: null,
      fullName: "Example User",
      dateOfBirth,
      gender: "prefer_not_to_say",
      phone: "9999999999",
      onboardingCompleted: true,
      isAdmin: false,
    },
  });

  assert.equal(parsed.user?.dateOfBirth, dateOfBirth);
  assert.equal(JSON.stringify(parsed).includes("T00:00:00.000Z"), false);
});