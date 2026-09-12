# EzyRetire fonts

EzyRetire self-hosts the font faces referenced by the shared design-system
typography tokens. The current `ezyretire-v3` directory is a versioned,
immutable WOFF2 asset set:

- Inter 400, 500, 600, and 700
- DM Serif Display 400

Both families are distributed under the SIL Open Font License 1.1. The complete
license text for each family is shipped beside the font files.

The v3 files retain the exact approved per-face Latin and Latin Extended
character contracts, financial
currency symbols (including ₹, $, €, £, and ¥), punctuation, and common UI
symbols. The original approved full TrueType faces remain unchanged in
`ezyretire-v1`; v3 is a compressed, browser-ready subset of those same faces.

## Updating fonts

Place approved full TTF faces and both license files in a source version
directory, then run:

```sh
pnpm fonts:build -- --source ezyretire-v1 --target ezyretire-v4
```

The command uses the exact FontTools and Brotli versions pinned in the
repository's `pyproject.toml` and `uv.lock`. It creates the target directory only
when that version does not already exist, subsets every face to the checked-in
per-face Unicode contracts, copies both licenses, creates `fonts.css` and an
immutable checksum manifest, and verifies every required code point plus the
EzyRetire glyph sample in every applicable face. A failed build removes its own
incomplete target; it never changes an existing version.

To verify an already generated version independently:

```sh
pnpm fonts:verify -- --verify ezyretire-v3
```

The exact supported ranges are defined once per face in
`scripts/build-font-version.mjs`. They preserve all 303 selected code points in
the approved DM Serif source and all 977 selected code points in each approved
Inter source, covering Basic Latin, Latin Extended A/B and Additional, general
punctuation, currency symbols, letterlike symbols, arrows, geometric shapes,
miscellaneous symbols, and dingbats. Update the stylesheet link in `index.html`
only after the new directory passes verification. Keep font-family names and
weights aligned with the design-system tokens. Normal generation and
verification always use the locked repository toolchain; executable overrides
exist only in the imported test API for failure-path testing.

## Production caching

Files below a released version directory are immutable and may be served with:

```text
Cache-Control: public, max-age=31536000, immutable
```

`index.html` must remain revalidated or short-lived so a deployment can point
clients to a newer version directory. This versioned path prevents long-lived
font caches from retaining stale binaries after a font update.