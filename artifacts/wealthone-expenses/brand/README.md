# ezyRetire brand assets

`mark.svg` is the approved compact mark used by full-size brand and app-icon
assets. `favicon.svg` is its dedicated browser treatment: a slightly enlarged
mark on a softly rounded tile. `favicon.png` is generated from that treatment.
Do not edit files in `public/` or the design-system favicon directly.

Regenerate every favicon, install icon, maskable icon, social image, and
design-system variant from their respective SVG sources at the workspace root:

```sh
pnpm --filter @workspace/wealthone-expenses brand:build
```

Verify that committed outputs are current without modifying them:

```sh
pnpm --filter @workspace/wealthone-expenses brand:check
```

The package test and build commands run the check automatically, so stale brand
assets fail CI.