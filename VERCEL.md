# Private Object Storage broker

Vercel continues to host the API, authentication, and finance routes, but it
does not receive Object Storage bucket credentials and never contacts the
Replit localhost sidecar. Set `REPLIT_STORAGE_BROKER_ORIGIN` to the verified
HTTPS origin of the production Replit deployment (no path, query, credentials,
or fragment). Set the same strong `STORAGE_BROKER_SECRET` in Replit and Vercel.
A domain-separated key derived from `SESSION_SECRET` is retained only as a
backward-compatible fallback. Both a dedicated secret and a fallback
`SESSION_SECRET` root must contain at least 32 bytes.

If the Replit deployment is private, set `PUBLISHED_SITE_ACCESS_TOKEN` on
Vercel and update it after every republish. The API sends it only as a
server-side `Authorization: Bearer` header to the Replit deployment. It is
never placed in broker URLs or bodies. `PRIVATE_OBJECT_DIR` and
all Object Storage bucket configuration belong only on Replit.

Financial backups larger than Vercel's request-ingress limit must use
`POST /api/financial-data/restore-uploads/request-url`, upload the exact
`application/json` byte count to the returned signed URL, and submit only the
small `{ "restoreUpload": { "objectPath": "...", "size": 123 } }` envelope to
`POST /api/financial-data/restore`. The broker pins and promotes that upload
before parsing it; Vercel never receives the large request body. Direct restore
JSON remains supported for smaller callers. Existing `/objects/vault/<uuid>`
documents are legacy read/delete-compatible only when the database proves
same-account ownership.

# Vercel deployment rules

This repo is a **pnpm workspace**: a Vite SPA plus an Express app compiled as Vercel serverless functions. Local `tsc` uses `moduleResolution: "bundler"`. Vercel’s function compiler uses **Node ESM** (`module` / `moduleResolution`: `nodenext`). Code that typechecks locally can still fail the Vercel build. Follow this file whenever you add imports, packages, or schema.

## What Vercel actually builds

| Step | Command / path | What Vercel accepts |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | Lockfile must match every `package.json`. Any extra/moved dependency without a lockfile update fails install. |
| Frontend | `pnpm --filter @workspace/wealthone-expenses run build` | Vite production build. `VERCEL=1` supplies `PORT`/`BASE_PATH`. Output must exist. |
| Static output | `artifacts/wealthone-expenses/dist/public` | Directory must contain `index.html` after the build. Path is **relative to the repo root**. |
| API | `api/**/*.ts` | TypeScript compiled as Node ESM. Entry is `api/[...path].ts` → Express `app`. |
| SPA fallback | `rewrites: /((?!api/).*) → /index.html` | Client-side routes work only if `vercel.json` is read from the **repo root**. The `api/` exclusion is required — see below. |

### The SPA fallback must exclude `/api/`

Use `rewrites` with a negative lookahead. Never use the legacy `routes` + `handle: filesystem` form:

```json
"rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]
```

`handle: filesystem` matches static files and *statically named* functions, but **not dynamic ones**. Our only function is `api/[...path].ts`, a dynamic catch-all, so with legacy `routes` a catch-all `/(.*) → /index.html` is evaluated first and swallows every `/api/*` request.

The failure is silent and confusing: `/api/login` returns `index.html` with HTTP 200, the SPA boots at the URL `/api/login`, no client route matches, and you get the app's own **"404 Page Not Found — Did you forget to add the page to the router?"** page instead of an OIDC redirect. Auth, and every other API call, is dead.

With `rewrites`, Vercel checks the filesystem (including dynamic functions) *before* applying them, so `/assets/*` and `/api/*` resolve correctly on their own.

Quick check after any deploy: `curl -s https://<app>/api/auth/user` must return JSON (`{"user":null}`), not HTML.

Do **not** use the root `pnpm run build` as the Vercel build command. That typechecks every workspace package (including `mockup-sandbox`) and is not what production needs.

### Functions and the database must sit in the same region

`vercel.json` pins functions to `sin1` (Singapore) because the Neon project is in `ap-southeast-1` (Singapore). Keep these two together. If the plan later includes Mumbai (`bom1`) and you move Neon to `ap-south-1`, change both in the same commit.

A save writes the whole document, which is around ten statements inside one transaction. Every statement is a separate round trip, so the region gap is multiplied by ten:

| Function region | Database region | Round trip | Typical save |
|---|---|---|---|
| `sin1` | `ap-southeast-1` | a few ms | tens of ms |
| `iad1` (Vercel default) | `ap-southeast-1` | ~200 ms+ | seconds |

If you ever move the Neon project, change `regions` in `vercel.json` in the same commit. Leaving it on the default `iad1` with an Asia database is the single most expensive mistake available here.

Local development pays this gap unavoidably, since your machine is not in a data centre next to Neon. Expect saves to be slower locally than in production.

### Email sign-in must finish before the function deadline

The email OTP delivery policy in `artifacts/api-server/src/lib/email-otp.ts` has one
8-second end-to-end provider budget, including all attempts and retry delays.
`vercel.json` gives API functions 30 seconds. Keep the delivery budget at no more
than 10 seconds and always below `maxDuration`; the remaining time is reserved for
challenge issuance, preserving or deleting challenge state after delivery failure,
logging, and serializing the JSON response.

Do not calculate the worst case by looking only at a single provider attempt.
Attempt timeouts, retry count, and retry delays must all fit inside the shared
delivery budget. Transport timeouts and ambiguous provider outcomes must leave the
same deterministic challenge pending for a same-code, same-idempotency-key retry.
Definitive configuration, sender, quota, or recipient failures may delete the new
pending challenge. Increasing Vercel's function duration is not a substitute for
bounding provider work.

If either timeout policy changes, update the explicit budget test in
`email-otp.test.ts` and confirm the API still has ample cleanup/JSON-response
headroom under the `functions.api/**/*.ts.maxDuration` value in `vercel.json`.

### Dashboard settings Vercel accepts

- **Root Directory:** empty (repository root). If this is `artifacts/api-server`, `vercel.json` is ignored, output path is wrong, and `api/[...path].ts` is not deployed.
- **Framework Preset:** Other (`vercel.json` has `"framework": null`). Express preset expects a server, not a static `outputDirectory`.
- **Build / Output / Install overrides:** off. Let `vercel.json` be the source of truth.
- Redeploy the **latest commit**. Redeploying an old failed deployment rebuilds that commit, not `main`.

## TypeScript / ESM (functions)

Vercel compiles the function graph with **explicit file extensions** on relative imports.

**Do**

```ts
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
export * from "./schema/index.js";
```

**Do not**

```ts
import router from "./routes";
import { logger } from "./lib/logger";
export * from "./schema";
```

Rules:

- Relative specifiers (`./` and `../`) need a `.js` suffix even though the source file is `.ts`. TypeScript maps `.js` → `.ts`.
- A directory import must be `./foo/index.js`, not `./foo.js`.
- Already-valid `.mjs` imports (e.g. `../database-url.mjs`) stay as `.mjs`.
- Workspace packages (`@workspace/db`, `@workspace/api-zod`) stay bare specifiers. Their **internal** barrels still need `.js`.
- `api/[...path].ts` must import `../artifacts/api-server/src/app.js`.

Apply this in every new file under:

- `api/`
- `artifacts/api-server/src/`
- `lib/db/src/`
- `lib/api-zod/src/` (including **generated** files)

The frontend (`artifacts/wealthone-expenses`) uses Vite `bundler` resolution. Relative `.js` is optional there, but the API/libs above are not optional.

### Generated OpenAPI code

`lib/api-zod` (orval) often emits extensionless `export * from './foo'`. Regenerating **will undo** the `.js` suffixes and break Vercel until they are put back. After any `orval` / API-spec generate:

1. Re-add `.js` (and `/index.js` for directories) in `lib/api-zod/src`.
2. Confirm `lib/api-zod/src/index.ts` is:

   `export * from "./generated/api.js"` and `export * from "./generated/types/index.js"`.

Prefer a generator option or a post-generate script so this is not manual.

### Interop (`pino-http`, CJS default exports)

`tsconfig.base.json` must keep `"esModuleInterop": true`.

`pino-http` is CommonJS with ESM-shaped types. Under `nodenext`, default import is not callable. Use:

```ts
import { pinoHttp } from "pino-http";
```

For other CJS libraries, prefer a named export or `esModuleInterop` — do not assume `import pkg from "cjs-lib"` works on Vercel.

## pnpm lockfile

Install is **frozen**. After any `package.json` change (add/remove/move a dependency):

```bash
pnpm install
```

Commit **both** `package.json` and `pnpm-lock.yaml`. Committing only one causes `ERR_PNPM_OUTDATED_LOCKFILE`.

`tailwindcss` for `@workspace/wealthone-design-system` must stay in **`devDependencies`**, matching the lockfile. Moving it to `dependencies` without regenerating the lockfile fails Vercel install.

## One copy of each package (`nodeLinker: hoisted`)

`pnpm-workspace.yaml` must keep:

```yaml
nodeLinker: hoisted
```

Vercel’s function bundler **dereferences pnpm symlinks**. Isolated/default linking then produces two physical copies of `drizzle-orm` (one under `api-server`, one under `@workspace/db`). TypeScript treats `SQL` as incompatible (`shouldInlineParams` is private).

Hoisting keeps one physical `node_modules/drizzle-orm`. Do not switch back to isolated linking without a different packaging strategy (pre-bundle the API with esbuild).

`@types/express-serve-static-core` is an **explicit** `devDependency` of `@workspace/api-server`. Do not rely on it arriving only as a nested dependency of `@types/express`. If it is missing, `Express` becomes an empty interface and every `app.use()` fails (`TS2339`), with the real error hidden by `skipLibCheck`.

## Environment Vercel accepts

Set in **Project Settings → Environment Variables** (Production; Preview separately if needed):

| Variable | Role |
|---|---|
| `DATABASE_URL` | Pooled Neon/Vercel Postgres URL (SSL). The API reads this when `DATABASE_URL_VARIABLE=DATABASE_URL` or on Vercel by default. |
| `DATABASE_URL_VARIABLE` | Set to `DATABASE_URL` on Vercel. |
| `APP_URL` | Public origin, **no trailing slash** (e.g. `https://your-project.vercel.app`). |
| `ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Auth. |
| `ADMIN_EMAILS` | Admin allow-list. |
| `CRON_SECRET` | Long random secret used by Vercel to authorize scheduled maintenance. |
| `WHATSAPP_*` | Optional; without them, WhatsApp sends are recorded as skipped. |

### Neon-only database guardrails

If you want this deployment to use Neon only (and never a different Postgres):

1. Set `DATABASE_URL_VARIABLE=DATABASE_URL` in Vercel (Production and Preview).
2. Set `DATABASE_URL` to your Neon pooled SSL connection string.
3. Optionally set `NEON_DATABASE_URL` to the same Neon value for parity across non-Vercel environments.
4. Do not set any non-Neon URL for either variable in Vercel.

Current runtime behavior already enforces this selection: if the selected variable is missing, startup fails instead of silently falling back to another variable.

Schema changes belong in `lib/db`. Apply them **once** against the **unpooled** URL (`DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING`):

```bash
DATABASE_URL_VARIABLE=DATABASE_URL DATABASE_URL='unpooled-url' pnpm --filter @workspace/db run push
```

Do not run `drizzle-kit push` on every serverless invocation.

After adding tables under `lib/db/src/schema/finance.ts`, push once (same as above). Do not change Root Directory or install/build overrides. In `vercel.json`, only `regions` is meant to change, and only when the database region changes. New relative files in `lib/db` and `api-server` must keep `.js` import suffixes.

**Finance persistence (Neon tables):** expenses, budgets, income_sources, salary_details, investments, loans, user_profiles, retirement_plans. The SPA still uses `GET`/`PUT` `/api/financial-data` (same `/api` catch-all). That endpoint reads/writes the tables above, not a JSON column on `users`. `financial_accounts` and `dependents` exist for later screens; they are unused by the current UI.

## Local check before you push

From the repo root (Node **20.19+** or **22.12+**; Vite 7 rejects older 20.x):

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/wealthone-expenses run typecheck
VERCEL=1 pnpm --filter @workspace/wealthone-expenses run build
```

To approximate Vercel’s function compiler:

```bash
# tsconfig with module/moduleResolution nodenext, files: ["api/[...path].ts"]
npx tsc -p that-config --noEmit
```

That compile must be clean. A passing `api-server` typecheck (`bundler`) is **not** sufficient.

On macOS, a Linux-generated lockfile may omit darwin optional natives (`@rollup/rollup-darwin-arm64`, lightningcss, Tailwind oxide). That is local-only. Vercel is Linux and uses the `linux-x64-gnu` binaries in the lockfile.

## Checklist for a typical change

- [ ] New relative import in `api/`, `api-server`, `lib/db`, or `lib/api-zod` uses `.js` / `index.js`.
- [ ] Regenerated orval output was re-suffixed (or the generator emits extensions).
- [ ] `package.json` edits were followed by `pnpm install` and **both** files committed.
- [ ] `nodeLinker: hoisted` and `esModuleInterop` were not removed.
- [ ] `@types/express-serve-static-core` still listed on `api-server`.
- [ ] Vercel Root Directory still empty; no command overrides.
- [ ] Deploy log `Commit:` SHA matches the commit you just pushed.

## Why past Vercel failures happened

1. Frozen lockfile vs `tailwindcss` moved between `dependencies` / `devDependencies`.
2. Root Directory set to `artifacts/api-server` → no `outputDirectory`, missing `public`.
3. Function compile (`nodenext`) vs extensionless relative imports.
4. `pino-http` default import not callable.
5. `@workspace/api-zod` barrels without `.js` → `AuthUser` “not exported”.
6. Two copies of `drizzle-orm` after symlink dereference → `SQL<unknown>` mismatch.
7. Redeploy of an **old** commit after the fix was only on a later SHA.
