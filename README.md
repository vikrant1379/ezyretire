# ezyRetire

ezyRetire is a local-first personal-finance application for Indian households. Income, expenses, budgets, investments, loans, and retirement projections stay in the browser. The server stores only authenticated advice-request coordination data, advisor assignments, sessions, and WhatsApp delivery records.

## Repository structure

- `artifacts/wealthone-expenses` — React and Vite frontend
- `artifacts/api-server` — Express API
- `lib/api-spec` — OpenAPI contract
- `lib/api-client-react` and `lib/api-zod` — generated clients and validators
- `lib/db` — PostgreSQL schema and Drizzle access

## Local development

This repository uses pnpm:

```bash
corepack enable
pnpm install
pnpm run typecheck
```

On Replit, start the existing ezyRetire and API workflows. Outside Replit, provide the variables documented in `.env.example`; the frontend Vite configuration expects `PORT` and `BASE_PATH` unless `VERCEL=1`.

### Database selection

The API reads exactly one PostgreSQL connection variable; it never falls back
from one database to another:

- Set `DATABASE_URL_VARIABLE=NEON_DATABASE_URL` in Replit preview to keep preview
  accounts, advice requests, payments, advisor assignments, and notifications in
  the intended Neon database.
- Set `DATABASE_URL_VARIABLE=DATABASE_URL` in Vercel Preview and Production.
  Vercel also defaults to `DATABASE_URL` when the selector is omitted, preserving
  existing Vercel behavior.
- Non-Vercel runtimes default to `NEON_DATABASE_URL` when the selector is omitted.
  Setting the selector explicitly is recommended in every environment.

At startup, the API logs the selected variable name (`DATABASE_URL` or
`NEON_DATABASE_URL`) but never its connection-string value. Changing databases
does not migrate or copy existing login sessions; users must sign in again, and
old sessions remain only in their original database.

## Deploy to Vercel

Vercel compiles `api/**/*.ts` as Node ESM (`nodenext`), which is stricter than local `tsc`. Before changing imports, packages, or generated API code, read **[VERCEL.md](./VERCEL.md)**.

1. Push this repository to GitHub.
2. Import the repository into Vercel and leave the project root at the repository root.
3. Vercel reads `vercel.json`, installs with pnpm, builds ezyRetire, serves the SPA, and exposes the Express app through `api/[...path].ts`.
4. Add the required environment variables from `.env.example` in **Project Settings → Environment Variables**.
5. Set `APP_URL` to `https://www.ezyretire.com`, without a trailing slash. Configure `www.ezyretire.com` as the primary domain so it matches the app's canonical and social metadata.
6. Apply the database schema once from a trusted local or CI environment:

   ```bash
   DATABASE_URL_VARIABLE=DATABASE_URL DATABASE_URL='your-production-url' pnpm --filter @workspace/db run push
   ```

   Existing databases created before lifetime budget plans can instead apply the
   reviewed additive transition in
   `lib/db/migrations/20260905_add_budget_details.sql` before deploying the API.

7. Before each release, verify that the production schema supports the current API:

   ```bash
   DATABASE_URL_VARIABLE=DATABASE_URL DATABASE_URL='your-production-url' pnpm run check:production-schema
   ```

   GitHub Actions runs this check on pushes to `main`. Add the production Neon connection
   string as the `NEON_DATABASE_URL` repository secret; the check only reads PostgreSQL
   system catalogs and never prints the connection string.

8. Configure your OIDC provider to allow this exact callback:

   ```text
   https://your-project.vercel.app/api/callback
   ```

9. Deploy again after the final domain and environment variables are configured.

### Required production services

- **PostgreSQL:** Use a managed Postgres provider's pooled/serverless URL with SSL. Do not run schema pushes on every serverless invocation.
- **Authentication:** Set `ISSUER_URL` and `OIDC_CLIENT_ID`; set `OIDC_CLIENT_SECRET` when the provider requires a confidential client. Replit continues to use `REPL_ID` automatically when `OIDC_CLIENT_ID` is absent.
- **Administration:** Set `ADMIN_EMAILS`. `REPL_OWNER_ID` is only useful for Replit identities.
- **Scheduled maintenance:** Set a long random `CRON_SECRET`. Vercel sends it to the daily login-activity retention job.
- **WhatsApp:** Set the six `WHATSAPP_*` variables to enable approved Business Cloud API templates. Without them, messages are safely recorded as skipped.

### Vercel preview deployments

OIDC callbacks require an allow-listed origin. Use the production domain for sign-in testing, or add each preview callback URL to your identity provider. Keep `APP_URL` scoped separately for Preview and Production if both environments need authentication.

## Verification

```bash
pnpm run typecheck
DATABASE_URL_VARIABLE=DATABASE_URL DATABASE_URL='your-production-url' pnpm run check:production-schema
VERCEL=1 pnpm --filter @workspace/wealthone-expenses run build
```

### Release database check

After deployment, confirm the API startup log names the expected database
variable. Then sign in with a dedicated release-check account, submit one advice
request, and run the read-only record check against that same database:

```bash
DATABASE_URL_VARIABLE=DATABASE_URL \
DATABASE_URL='your-production-url' \
RELEASE_CHECK_EMAIL='release-check@example.com' \
pnpm run check:release-records
```

The command reports the selected variable name, never its value or the account
email, and passes only when both the login account and its linked advice request
exist there. It reads records only. Delete the test advice request through the
normal application flow if desired; do not copy sessions or records between
databases.

### PWA release check

Run the installability and offline check against the compiled production artifact:

```bash
pnpm run check:pwa
```

The command builds ezyRetire, serves that build locally, and reports a failing
Playwright assertion if the manifest or Apple metadata is incomplete, an icon is
missing or has the wrong dimensions, the service worker does not control the
production scope, obsolete caches remain, offline navigation misses the branded
fallback, or an `/api/` request can be served from a cache. It is also included
in `pnpm run check:release`.

The Safari-like private-storage warning project runs for every pull request
targeting `main`, again on the resulting `main` commit after merge, or when its
workflow is started manually. The
`WebKit private-storage warning` job uses a Playwright-supported Ubuntu host and
installs WebKit with its native libraries.

Treat `WebKit private-storage warning` as a required passing check in the GitHub
branch ruleset for `main`, and require changes to reach `main` through pull
requests. Do not publish a release from an unmerged branch or bypass that rule.
With this release path, a failed, cancelled, or missing hosted WebKit run blocks
the pull request from merging and therefore blocks publication.

Publish GitHub releases only through the **Publish guarded release** workflow.
From a GitHub CLI session authenticated for this repository, run:

```bash
gh workflow run publish-release.yml \
  -f tag_name=v1.2.3 \
  -f target_commitish=main
```

The workflow resolves `target_commitish` to an immutable commit, verifies that
the commit is reachable from `main`, and requires a completed, successful
`WebKit private-storage warning` check on that exact commit. A missing,
cancelled, or failed check stops publication. After the guard passes, the
workflow creates the tag and GitHub release at the verified commit. Do not use
`gh release create` or the GitHub release form directly.

To configure the gate in GitHub, open **Settings → Rules → Rulesets**, create or
edit the ruleset targeting the `main` branch, require a pull request before
merging, enable **Require status checks to pass**, and select
`WebKit private-storage warning`. Also require branches to be up to date before
merging so the check passes against the release candidate commit.

The **Audit release ruleset** GitHub Actions workflow audits the hosted
configuration every day at 08:17 UTC and can also be started manually from the
Actions tab. A failed run names each missing protection without printing the
credential. It also opens the repository issue **Release protection audit is
failing**. While the incident remains active, later failures update that issue
with the latest run link instead of opening duplicates. The next successful run
closes it with a recovery link. The workflow identifies its issue by both the
`release-protection-alert` label and a hidden ownership marker; a manually
created issue with the same title is never edited or closed.

To configure the scheduled audit:

1. Create a fine-grained personal access token limited to this repository.
2. Grant it read-only **Administration** repository permission and no write
   permissions. Use a dedicated automation owner where your organization
   permits one.
3. In **Settings → Secrets and variables → Actions**, add the token as the
   repository secret `RELEASE_RULESET_AUDIT_TOKEN`.
4. In the same page's **Variables** tab, add
   `RELEASE_RULESET_ALERT_MENTION` with the GitHub team mention that owns release
   protection, such as `@your-organization/release-maintainers`. This is a
   non-secret routing value. The named team must have repository access and
   GitHub issue mentions enabled. If the variable is omitted, the issue addresses
   “Maintainers” without mentioning a team.
5. Have the release-maintainer team watch repository issues, and make that team
   responsible for acknowledging the alert, restoring the ruleset, and manually
   re-running the audit. GitHub's workflow token creates, updates, and closes the
   alert issue; the separate audit token remains read-only and is never included
   in the issue.
6. Open **Actions → Audit release ruleset → Run workflow** and confirm
   **Verify main release protections** passes.

Audit the hosted configuration locally after changing repository rules and
before a release:

```bash
GITHUB_REPOSITORY='owner/repository' GITHUB_TOKEN='your-fine-grained-token' \
pnpm run audit:release-ruleset
```

Use the same least-privilege token policy for local audits. Store the credential
in a password manager, GitHub Actions secret, or an environment variable; never
add it to this repository, a command script, or diagnostic output. The audit
reads the repository and its rulesets and fails separately when `main` lacks an
active pull-request rule, up-to-date branch enforcement, or the exact `WebKit
private-storage warning` required check.

Rotate the Actions credential before it expires, when its owner or repository
access changes, or immediately if exposure is suspected: create a replacement
with the same single-repository and read-only Administration scope, replace the
`RELEASE_RULESET_AUDIT_TOKEN` secret, manually run the workflow, and only then
revoke the old token. GitHub secret values cannot be viewed after saving; a
failure saying the API returned `401` or `403` indicates an expired, revoked, or
incorrectly scoped credential and does not reveal it.

To repair a failure, open **Settings → Rules → Rulesets**, edit the active branch
ruleset that includes `main`, and restore the named missing setting. If the status
check is unavailable in the selector, manually run **Release WebKit PWA check**
once on the repository's default branch, then select its
`WebKit private-storage warning` job. Re-run the audit; do not paste a token into
an issue, log, or committed file.

Also create an active tag ruleset for the release tag pattern (for example,
`v*`). Enable **Restrict creations**, **Restrict updates**, and **Restrict
deletions**. Give only the GitHub Actions integration used by **Publish guarded
release** an always-allow bypass; do not grant a repository role or maintainer
team a bypass. This makes guarded automation the only path that can create or
move release tags, so using the release form or `gh release create` against an
unverified commit cannot bypass the gate.

Validate this setup after enabling the rulesets:

1. Squash-merge a pull request whose `WebKit private-storage warning` check
   passed.
2. Wait for the same check to pass on the resulting `main` SHA, then dispatch
   **Publish guarded release** for that exact SHA with a temporary release tag.
3. Confirm the guarded release succeeds, then delete the temporary release
   through an authorized cleanup process.
4. Try creating a different release tag directly from a non-`main` commit and
   confirm the tag ruleset rejects it.

To run the same focused check on another supported host:

```bash
pnpm exec playwright install --with-deps webkit
pnpm --filter @workspace/wealthone-expenses run check:pwa:webkit-release
```

After publishing over HTTPS, open the site in Chromium and confirm the browser's
application panel reports the expected ezyRetire manifest and a running service
worker. Switch the panel to offline and navigate to a new in-scope URL; the
ezyRetire offline page should appear. On iOS or iPadOS, use **Add to Home Screen**
and confirm the ezyRetire name and supplied 180 px icon before adding it.

Never commit `.env` files, Vercel metadata, database credentials, or WhatsApp access tokens.
