import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("successful OTP and OIDC boundaries record once while routine auth reads do not", async () => {
  const source = await readFile(new URL("./src/routes/auth.ts", `file://${process.cwd()}/`), "utf8");
  assert.equal((source.match(/safelyRecordLogin\(req, result\.user\.id, "email_otp"\)/g) ?? []).length, 1);
  assert.equal((source.match(/safelyRecordLogin\(req, login\.dbUser\.id, "oidc"\)/g) ?? []).length, 1);
  const authUserRoute = source.slice(
    source.indexOf('router.get("/auth/user"'),
    source.indexOf('router.patch("/auth/profile"'),
  );
  assert.doesNotMatch(authUserRoute, /recordLoginActivity|safelyRecordLogin/);
});