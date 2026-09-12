import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const appStyles = await readFile(
  new URL("../src/index.css", import.meta.url),
  "utf8",
);

const fallbackSource = appSource.slice(
  appSource.indexOf("function RouteLoadingFallback()"),
  appSource.indexOf("function AppRoutes()"),
);

test("both loading fallbacks preserve the tagline and its theme colors", () => {
  const taglineMarkup =
    '<p className="-mt-1 animate-pulse text-sm font-medium tracking-[0.18em] text-loading-tagline">\n' +
    "          Track • Plan • Retire\n" +
    "        </p>";

  assert.equal(
    fallbackSource.split(taglineMarkup).length - 1,
    2,
    "full-page and in-shell loaders must use the same light and dark tagline colors",
  );
  assert.match(
    appStyles,
    /--color-loading-tagline:\s*var\(--loading-tagline\)/,
  );
  assert.match(appStyles, /:root\s*{[^}]*--loading-tagline:\s*hsl\(var\(--muted-foreground\)\)/s);
  assert.doesNotMatch(appStyles, /#d4af37/i, "loading copy must not introduce a decorative warning-like gold");
});
