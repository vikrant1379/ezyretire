# Workspace cleanup inventory — 2026-09-11

Removed 21 tracked files: 13 byte-identical upload copies and 8 obsolete root helpers. Gross working-tree savings: **8,394,692 bytes (8.39 MB / 8.01 MiB)**. Uploads decreased from 24,942,031 to 16,551,167 bytes. This excludes this report and ignore-rule additions; Git history and deployment bundle size are not reduced by this claim. Initial working tree was clean.

## Deleted paths

For duplicate uploads, the retained counterpart was verified byte-for-byte and by SHA-256 before unlinking. No deleted filename appeared in tracked source/configuration/documentation or local task plans. Dynamic loading and the Vite @assets alias were checked separately; no directory-wide upload loader was found.

| Deleted path | Bytes | Reason / retained identical counterpart |
| --- | ---: | --- |
| attached_assets/0_dark-mode-app-logo_1788921627582.png | 863758 | Duplicate of attached_assets/dark-mode-app-icon_1788920659714.png |
| attached_assets/0_dark-mode-app-logo_1788921723142.png | 863758 | Duplicate of attached_assets/dark-mode-app-icon_1788920659714.png |
| attached_assets/0_dark-mode-app-logo_1788921753936.png | 863758 | Duplicate of attached_assets/dark-mode-app-icon_1788920659714.png |
| attached_assets/dark-mode-app-icon_1788920625192.png | 863758 | Duplicate of attached_assets/dark-mode-app-icon_1788920659714.png |
| attached_assets/0_dark-mode-hz_1788922590135.png | 454969 | Duplicate of attached_assets/dark-mode-hz_1789063919926.png |
| attached_assets/1_light-mode-app-logo_1788921627583.png | 1233362 | Duplicate of attached_assets/light-mode-app-logo_1788920769469.png |
| attached_assets/1_light-mode-app-logo_1788921723143.png | 1233362 | Duplicate of attached_assets/light-mode-app-logo_1788920769469.png |
| attached_assets/1_light-mode-app-logo_1788921753936.png | 1233362 | Duplicate of attached_assets/light-mode-app-logo_1788920769469.png |
| attached_assets/1_light-mode-hz_1788922590136.png | 481557 | Duplicate of attached_assets/light-mode-hz_1789063924461.png |
| attached_assets/IMG_3190_1788992627253.PNG | 244408 | Duplicate of attached_assets/IMG_3190_1788972312087.PNG |
| attached_assets/image_1788992242398.png | 10633 | Duplicate of attached_assets/image_1788992146606.png |
| attached_assets/image_1788992670571.png | 10633 | Duplicate of attached_assets/image_1788992146606.png |
| attached_assets/image_1788995718030.png | 33546 | Duplicate of attached_assets/image_1788995743405.png |
| fix-account-deletion.js | 404 | One-off replacement of existing test text, not a test or package command; no callers. Actual tests retained unchanged. |
| fix-dark-theme-test.js | 382 | One-off replacement of existing test text, not a test or package command; no callers. Actual tests retained unchanged. |
| fix-dark-theme-test-2.js | 713 | One-off replacement of existing test text, not a test or package command; no callers. Actual tests retained unchanged. |
| fix-dark-theme-test-3.js | 536 | One-off replacement of existing test text, not a test or package command; no callers. Actual tests retained unchanged. |
| fix-dark-theme-test-4.js | 355 | One-off replacement of existing test text, not a test or package command; no callers. Actual tests retained unchanged. |
| parse-sections.js | 236 | Incomplete read-only extraction scratch; produces no output. |
| split-profile.js | 848 | Incomplete read-only extraction scratch; produces no output. |
| test-passkey.js | 354 | One-off replacement of existing test text, not a test or package command; no callers. Actual tests retained unchanged. |

## Preserved intentionally

- All five approved branding source PNGs: fevicon_1788696519503.png, mobile-app-icon-logo_1788990742871.png, lodericon-darkmode_1788994352024.png, light-mode-hz_1789063924461.png, dark-mode-hz_1789063919926.png.
- All generated/public branding assets, launcher/favicons, both loader marks, fonts/licenses, screenshots, fixtures, tests, source, and registered artifacts. Public copies are required outputs, not disposable duplicates.
- image_1788995743405.png is retained because a sidebar-branding task references it; its unreferenced identical counterpart was removed instead. dark-mode-app-icon_1788920659714.png is likewise the referenced retained copy.
- Unique older logos, screenshots and uploaded specifications remain: lack of an import is not proof that reference material is obsolete.
- fix-settings.js, fix-settings-2.js, fix-settings-3.js, profile-original.tsx and full-profile.txt remain uncertain recovery/profile-work materials; the settings scripts consume the snapshot. No broad ignore rule hides these or future source uploads.
- Protected storage untouched: .local (~1.3 GiB), node_modules (~959 MiB), .git (~98 MiB), screenshots (~1.5 MiB), application/private object storage, databases, secrets, memory and installed tools. Sizes are approximate filesystem measurements, not claimed savings.

## Prevention

.gitignore now excludes only regenerable playwright-report/ and blob-report/ directories. Existing dist, test-results and dependency ignores remain; attached_assets, public outputs and visual baselines are not blanket-ignored.

## Verification

- Before and after: PORT=3000 BASE_PATH=/ pnpm build passed (workspace typecheck and all package builds, including API, Canvas and ezyRetire).
- Before and after: FORCE_BRAND_CHECK=1 pnpm --filter @workspace/wealthone-expenses test verified actual ImageMagick regeneration, 12 brand/PWA asset hashes/provenance, font glyphs/licenses and financial-save architecture. Library/script stage: 436 passed, same 5 failed of 441; no new failures. The failures are install/offline canonical colors, dark color tokens, financial-health neutral presentation, decorative financial colors, and profile neutral/readable summary. Existing suite chaining stops before hook/component tests.
- Targeted brand-logo.test.tsx: supplied artwork test passed; navigation preload test fails on a stale login class-name expectation (h-16 max-w-[14rem]). Test and every source it reads are unchanged from baseline, so this is unrelated to cleanup. No assertions were weakened.
- git diff --check passed; final deletion list matched this inventory. Application source, public assets, package manifests and artifact definitions have no cleanup changes.
- Web workflow restarted and login screenshot showed the current logo and UI. API and Canvas workflows were initially not started; started them for final health checks.
- Final health checks: all three workflows running; `/`, `/__mockup/`, `/api/healthz`, `/brand-logo.png`, `/favicon.ico`, `/icon-512.png` and `/loader-icon-darkmode.png` returned HTTP 200.
