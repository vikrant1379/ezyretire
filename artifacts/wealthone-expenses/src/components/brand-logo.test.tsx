import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactRoot = new URL("../../", import.meta.url);

test("the full app logo and dark page mark use the supplied artwork", async () => {
  const [component, lightSource, lightGenerated, darkSource, darkGenerated, darkPageMarkSource, darkPageMarkGenerated, evidenceText] = await Promise.all([
    readFile(new URL("src/components/brand-logo.tsx", artifactRoot), "utf8"),
    readFile(
      new URL("../../../../attached_assets/light-mode-hz_1789063924461.png", import.meta.url),
    ),
    readFile(new URL("public/brand-logo.png", artifactRoot)),
    readFile(
      new URL("../../../../attached_assets/dark-mode-hz_1789063919926.png", import.meta.url),
    ),
    readFile(new URL("public/brand-logo-dark.png", artifactRoot)),
    readFile(
      new URL("../../../../attached_assets/lodericon-darkmode_1788994352024.png", import.meta.url),
    ),
    readFile(new URL("public/loader-icon-darkmode.png", artifactRoot)),
    readFile(new URL("public/brand-assets.json", artifactRoot), "utf8"),
  ]);
  const evidence = JSON.parse(evidenceText) as {
    approvedSources: Record<string, { file: string; sha256: string }>;
    assets: Array<{ file: string; width: number; height: number; sourceMarker: string }>;
  };
  const lightMarker = "ezyretire-light-horizontal-logo-supplied-v1";
  const darkMarker = "ezyretire-dark-horizontal-logo-supplied-v1";
  const darkPageMarkMarker = "ezyretire-golden-dark-loader-mark-supplied-v1";

  assert.equal(
    evidence.approvedSources[lightMarker]?.sha256,
    createHash("sha256").update(lightSource).digest("hex"),
  );
  assert.deepEqual(
    evidence.assets.find(({ file }) => file === "brand-logo.png"),
    {
      file: "brand-logo.png",
      width: 2167,
      height: 726,
      purpose: "in-app-light-full-logo",
      sourceMarker: lightMarker,
      sha256: createHash("sha256").update(lightGenerated).digest("hex"),
    },
  );
  assert.equal(
    evidence.approvedSources[darkMarker]?.sha256,
    createHash("sha256").update(darkSource).digest("hex"),
  );
  assert.deepEqual(
    evidence.assets.find(({ file }) => file === "brand-logo-dark.png"),
    {
      file: "brand-logo-dark.png",
      width: 2172,
      height: 724,
      purpose: "in-app-dark-full-logo",
      sourceMarker: darkMarker,
      sha256: createHash("sha256").update(darkGenerated).digest("hex"),
    },
  );
  assert.equal(
    evidence.approvedSources[darkPageMarkMarker]?.sha256,
    createHash("sha256").update(darkPageMarkSource).digest("hex"),
  );
  assert.deepEqual(darkPageMarkGenerated, darkPageMarkSource);
  assert.equal(
    evidence.assets.find(({ file }) => file === "loader-icon-darkmode.png")?.sourceMarker,
    darkPageMarkMarker,
  );
  assert.match(component, /brand-logo-compact\.png/);
  assert.match(component, /brand-logo-compact-dark\.png/);
  assert.equal(evidence.assets.find(({ file }) => file === "brand-logo-compact.png")?.width, 568);
  assert.equal(evidence.assets.find(({ file }) => file === "brand-logo-compact-dark.png")?.height, 152);
  assert.equal(
    evidence.assets.find(({ file }) => file === "brand-logo-compact.png")?.sourceMarker,
    lightMarker,
  );
  assert.equal(
    evidence.assets.find(({ file }) => file === "brand-logo-compact-dark.png")?.sourceMarker,
    darkMarker,
  );
  assert.match(component, /dark:hidden/);
  assert.match(component, /hidden h-full w-auto max-w-full object-contain dark:block/);
  assert.match(component, /dark:block/);
  assert.equal(component.match(/alt="ezyRetire"/g)?.length, 2);
  assert.equal(component.match(/fetchPriority="high"/g)?.length, 2);
  assert.equal(component.match(/decoding="sync"/g)?.length, 2);
  assert.doesNotMatch(component, /app-mark\.svg/);
  assert.match(component, /loader-icon-lightmode\.png/);
  assert.match(component, /loader-icon-darkmode\.png/);
});

test("navigation preloads compact logos while login keeps the canonical artwork", async () => {
  const [component, login, layout, themeProvider, app, indexHtml] = await Promise.all([
    readFile(new URL("src/components/brand-logo.tsx", artifactRoot), "utf8"),
    readFile(new URL("src/pages/login.tsx", artifactRoot), "utf8"),
    readFile(new URL("src/components/layout.tsx", artifactRoot), "utf8"),
    readFile(new URL("src/components/theme-provider.tsx", artifactRoot), "utf8"),
    readFile(new URL("src/App.tsx", artifactRoot), "utf8"),
    readFile(new URL("index.html", artifactRoot), "utf8"),
  ]);

  assert.match(component, /h-full w-auto max-w-full object-contain/);
  assert.match(login, /<BrandLogo className="h-16 max-w-\[14rem\]" \/>/);
  assert.match(login, /<BrandLogo className="h-20 max-w-\[16rem\]" \/>/);
  assert.doesNotMatch(login, /Track\. Plan\. Retire\./);
  assert.match(login, /dark:bg-transparent dark:p-0 dark:shadow-none/);
  assert.equal(layout.match(/<BrandLogo[\s\S]*?\bcompact\b[\s\S]*?\/>/g)?.length, 1);
  assert.match(
    layout,
    /fixed left-6 top-4[\s\S]*?xl:flex[\s\S]*?desktop-sidebar-logo/,
  );
  assert.match(
    layout,
    /<BrandLogo compact className="h-auto w-20 max-h-9 min-\[1360px\]:h-9 min-\[1360px\]:w-auto" \/>/,
  );
  assert.doesNotMatch(layout, /group-hover\/desktop-sidebar:h-/);
  assert.match(layout, /desktop-sidebar relative[\s\S]*?xl:block/);
  assert.match(layout, /duration-200 ease-out xl:hidden/);
  assert.match(layout, /mobile-bottom-navigation/);
  assert.match(layout, /sm:grid-cols-6 md:grid-cols-8 xl:hidden/);
  assert.doesNotMatch(layout, /\blg:(?:block|flex|hidden)\b/);
  assert.match(themeProvider, /root\.classList\.remove\("light", "dark"\)/);
  assert.match(themeProvider, /media\.addEventListener\("change", applyTheme\)/);
  assert.match(app, /const loginModulePromise = import\('@\/pages\/login'\)/);
  assert.match(app, /const Login = lazy\(\(\) => loginModulePromise\)/);
  assert.match(indexHtml, /rel="preload" as="image" href="\/brand-logo-compact\.png"/);
  assert.match(indexHtml, /rel="preload" as="image" href="\/brand-logo-compact-dark\.png"/);
  assert.match(indexHtml, /rel="preload" as="image" href="\/brand-logo\.png"/);
  assert.match(indexHtml, /rel="preload" as="image" href="\/brand-logo-dark\.png"/);
});
