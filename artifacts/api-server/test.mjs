import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const outputDir = new URL("./.test-dist/", import.meta.url);
const outputs = [
  new URL("whatsapp.test.mjs", outputDir),
  new URL("whatsapp-support.test.mjs", outputDir),
  new URL("auth-redirect.test.mjs", outputDir),
  new URL("email-otp.test.mjs", outputDir),
  new URL("email-otp-routes.test.mjs", outputDir),
  new URL("auth-response.test.mjs", outputDir),
  new URL("error-handler.test.mjs", outputDir),
  new URL("api-cache-policy.test.mjs", outputDir),
  new URL("advice-payment.test.mjs", outputDir),
  new URL("advice-routes.test.mjs", outputDir),
  new URL("finance-routes.test.mjs", outputDir),
  new URL("login-activity.test.mjs", outputDir),
  new URL("login-activity-routes.test.mjs", outputDir),
  new URL("login-activity-boundaries.test.mjs", outputDir),
  new URL("internal-maintenance-routes.test.mjs", outputDir),
];

await rm(outputDir, { recursive: true, force: true });
await build({
  entryPoints: {
    "whatsapp.test": new URL("./src/lib/whatsapp.test.ts", import.meta.url).pathname,
    "whatsapp-support.test": new URL(
      "./src/lib/whatsapp-support.test.ts",
      import.meta.url,
    ).pathname,
    "auth-redirect.test": new URL("./src/lib/auth-redirect.test.ts", import.meta.url).pathname,
    "email-otp.test": new URL("./src/lib/email-otp.test.ts", import.meta.url).pathname,
    "email-otp-routes.test": new URL("./src/lib/email-otp-routes.test.ts", import.meta.url).pathname,
    "auth-response.test": new URL("./src/lib/auth-response.test.ts", import.meta.url).pathname,
    "error-handler.test": new URL(
      "./src/middlewares/errorHandler.test.ts",
      import.meta.url,
    ).pathname,
    "api-cache-policy.test": new URL(
      "./src/middlewares/apiCachePolicy.test.ts",
      import.meta.url,
    ).pathname,
    "advice-payment.test": new URL("./src/lib/advice-payment.test.ts", import.meta.url).pathname,
    "advice-routes.test": new URL("./src/lib/advice-routes.test.ts", import.meta.url).pathname,
    "finance-routes.test": new URL("./src/lib/finance-routes.test.ts", import.meta.url).pathname,
    "login-activity.test": new URL("./src/lib/login-activity.test.ts", import.meta.url).pathname,
    "login-activity-routes.test": new URL("./src/lib/login-activity-routes.test.ts", import.meta.url).pathname,
    "login-activity-boundaries.test": new URL("./src/lib/login-activity-boundaries.test.ts", import.meta.url).pathname,
    "internal-maintenance-routes.test": new URL("./src/lib/internal-maintenance-routes.test.ts", import.meta.url).pathname,
  },
  outdir: outputDir.pathname,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  external: ["express", "pg-native", "pino"],
});

const result = spawnSync(process.execPath, ["--test", ...outputs.map((output) => output.pathname)], {
  stdio: "inherit",
});
await rm(outputDir, { recursive: true, force: true });
process.exitCode = result.status ?? 1;