# Mobile performance and brand release verification

## Repeatable automated proxies

Run from this package:

```sh
pnpm run check:bundle-budget
pnpm run check:mobile-performance
pnpm run brand:verify
```

The bundle build writes `dist/public/initial-entry-js-budget-report.json`. It
measures the entry and recursively imported static chunks plus their initial
CSS. Defaults are: raw entry JS <= 450 KiB, gzip initial JS <= 190 KiB, gzip
initial CSS <= 45 KiB, and <= 12 initial JS/CSS requests. Brotli totals are also
reported as evidence. Override the corresponding `INITIAL_*` environment
variables only when a reviewed change intentionally resets a baseline.

The mobile check uses a fresh Playwright Pixel 7 Chromium context against the
production build, blocks service workers to avoid warm-cache ambiguity, and
attaches `mobile-performance-evidence.json` under
`../../test-results/mobile-performance`. Thresholds are DOMContentLoaded <=
4000 ms, the signed-out heading visible <= 5000 ms, <= 12 initial JS/CSS
requests, and <= 700 KiB encoded initial JS/CSS from the uncompressed local
preview (the build report enforces compressed limits). Native first contentful paint
is recorded when the runtime exposes it, but the cross-runtime visible-content
milestone is the enforced paint proxy. These localhost Performance API values
are stable regression proxies, not claims about real-user Core Web Vitals.

`brand:verify` checks generated browser, install, maskable, and Apple
touch/splash assets for dimensions, purposes, hashes, and the approved
source markers recorded in `public/brand-assets.json`: `r-growth-bars-v1` for
install/touch assets and `r-growth-arc-glossy-supplied-v1` for browser assets.

## Latest workspace evidence

The 8 September 2026 cold-build check passed with:

- Entry JavaScript: 440,747 raw bytes, 141,442 gzip bytes, 121,394 Brotli bytes.
- Initial CSS: 181,635 raw bytes, 27,028 gzip bytes, 21,205 Brotli bytes.
- Initial JavaScript/CSS requests: 2 in the build graph.
- Pixel 7 proxy: 121 ms DOMContentLoaded, 192 ms first contentful paint, 233 ms
  until the signed-out heading was visible, and 3 initial font/JS/CSS requests.
- Install metadata and all seven browser, install, maskable, and Apple assets:
  verified against generated source provenance.

The machine-readable reports are
`dist/public/initial-entry-js-budget-report.json` and the attached
`mobile-performance-evidence.json` in the Playwright performance result.

Firefox launched on this workspace. The signed-out desktop and signed-in desktop
form checks passed. Its slow-local-font checks remain blocked because Firefox
does not issue the intercepted local-font request on this host; that gap is
tracked separately and must not be treated as completed physical-device proof.
The refreshed 48 px mobile More-menu snapshot passed in both Chromium and
Firefox.

Playwright WebKit downloads successfully but cannot launch on this Nix host
because its pinned Ubuntu build requires native GTK, GStreamer, ICU, graphics,
and media libraries unavailable here. Reproduce on the supported Ubuntu
validation host with:

```sh
pnpm exec playwright install --with-deps webkit
pnpm run check:design-system-cross-browser
```

## Required physical-device release checks

Automated Chromium and Playwright WebKit are proxies only. Before release:

1. On a current physical iPhone, open the deployed HTTPS URL in Safari, add it
   to the Home Screen, launch it, and verify the 180 px icon, launch/splash
   treatment, safe areas, title, theme color, and offline/recovery behavior.
2. On a current physical Android phone, open the deployed HTTPS URL in Chrome,
   install the app, and verify the 192 px launcher icon, 512 px maskable icon
   crop, launch treatment, title, theme color, and offline/recovery behavior.
3. Capture screenshots and complete this evidence block in the release record.

```text
Release/commit:
Deployed URL:
Date and verifier:
Automated bundle report: PASS/FAIL (attach JSON)
Automated mobile proxy: PASS/FAIL (attach JSON)
Brand provenance check: PASS/FAIL
iPhone model / iOS / Safari:
iPhone install, icon, splash, safe-area, offline/recovery: PASS/FAIL
Android model / Android / Chrome:
Android install, any/maskable icon, launch, offline/recovery: PASS/FAIL
Screenshot or recording links:
Exceptions and approval:
```