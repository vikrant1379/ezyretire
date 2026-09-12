import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactRoot = new URL("../../", import.meta.url);
const designSystemRoot = new URL("../wealthone-design-system/", artifactRoot);

test("install and offline colors match the canonical light theme tokens", async () => {
  const tokens = JSON.parse(
    await readFile(new URL("tokens.json", designSystemRoot), "utf8"),
  ) as {
    color: {
      light: { background: { $value: string } };
      dark: { background: { $value: string } };
    };
  };
  const manifest = JSON.parse(
    await readFile(new URL("public/site.webmanifest", artifactRoot), "utf8"),
  ) as {
    name: string;
    start_url: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
  };
  const offlineHtml = await readFile(
    new URL("public/offline.html", artifactRoot),
    "utf8",
  );
  const canonicalLaunchColor = tokens.color.light.background.$value;
  const offlineThemeColor = offlineHtml.match(
    /<meta\s+name="theme-color"\s+content="([^"]+)"\s*\/?>/,
  )?.[1];
  const offlinePalette = Object.fromEntries(
    [...offlineHtml.matchAll(/--offline-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(
      ([, role, value]) => [role, value],
    ),
  );
  const expectedOfflinePalette = {
    background: tokens.color.light.background.$value,
    surface: tokens.color.light.card.$value,
    text: tokens.color.light.cardForeground.$value,
    "muted-text": tokens.color.light.mutedForeground.$value,
    border: tokens.color.light.border.$value,
    action: tokens.color.light.primary.$value,
    "action-text": tokens.color.light.primaryForeground.$value,
    focus: tokens.color.light.ring.$value,
  };

  assert.equal(manifest.background_color, canonicalLaunchColor);
  assert.equal(manifest.theme_color, canonicalLaunchColor);
  assert.equal(offlineThemeColor, canonicalLaunchColor);
  assert.deepEqual(offlinePalette, expectedOfflinePalette);

  for (const role of Object.keys(expectedOfflinePalette)) {
    assert.match(
      offlineHtml,
      new RegExp(`var\\(--offline-${role}\\)`),
      `offline ${role} token is used by the page`,
    );
  }
});

test("browser chrome uses the resolved canonical theme color before React mounts", async () => {
  const tokens = JSON.parse(
    await readFile(new URL("tokens.json", designSystemRoot), "utf8"),
  ) as {
    color: {
      light: { background: { $value: string } };
      dark: { background: { $value: string } };
    };
  };
  const html = await readFile(new URL("index.html", artifactRoot), "utf8");
  const initialThemeColor = html.match(
    /<meta\s+name="theme-color"\s+content="([^"]+)"\s*\/?>/,
  )?.[1];
  const bootstrapScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

  assert.equal(initialThemeColor, tokens.color.light.background.$value);
  assert.match(
    bootstrapScript,
    new RegExp(`light:\\s*['"]${tokens.color.light.background.$value}['"]`),
  );
  assert.match(
    bootstrapScript,
    new RegExp(`dark:\\s*['"]${tokens.color.dark.background.$value}['"]`),
  );
  assert.match(
    bootstrapScript,
    /querySelector\(['"]meta\[name=["']theme-color["']\]['"]\)\.setAttribute\(['"]content['"],\s*themeColors\[resolved\]\)/,
  );
  assert.ok(
    html.indexOf("themeColors[resolved]") < html.indexOf('<script type="module"'),
    "theme color is resolved before the application module loads",
  );
});

test("discovery metadata consistently identifies ezyRetire and its canonical domain", async () => {
  const html = await readFile(new URL("index.html", artifactRoot), "utf8");
  const manifest = JSON.parse(
    await readFile(new URL("public/site.webmanifest", artifactRoot), "utf8"),
  ) as {
    name: string;
    start_url: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
  };
  const favicon = await readFile(new URL("public/favicon.svg", artifactRoot), "utf8");
  const faviconCacheIdentity = createHash("sha256").update(favicon).digest("hex").slice(0, 12);
  const faviconHref = (fileName: string) =>
    new RegExp(`href="/${fileName.replace(".", "\\.")}\\?v=${faviconCacheIdentity}"`);

  assert.match(html, /<title>ezyRetire — Track, plan, retire<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/www\.ezyretire\.com\/"/);
  assert.match(html, /property="og:url" content="https:\/\/www\.ezyretire\.com\/"/);
  assert.match(html, /property="og:image" content="https:\/\/www\.ezyretire\.com\/social-card\.png"/);
  assert.match(html, /name="twitter:image" content="https:\/\/www\.ezyretire\.com\/social-card\.png"/);
  assert.match(html, /rel="manifest" href="\/site\.webmanifest"/);
  assert.match(html, faviconHref("favicon.svg"));
  assert.match(html, faviconHref("favicon-32x32.png"));
  assert.match(html, faviconHref("favicon.ico"));
  assert.equal(html.match(new RegExp(`\\?v=${faviconCacheIdentity}`, "g"))?.length, 3);
  assert.doesNotMatch(html, /WealthOne|Retire Wise/);
  assert.equal(manifest.name, "ezyRetire");
  assert.equal(manifest.start_url, "/");
  assert.deepEqual(manifest.icons, [
    {
      src: "/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
  ]);
});

test("favicon, app icons, and social image use the ezyRetire brand asset family", async () => {
  const sourceMark = await readFile(new URL("brand/mark.svg", artifactRoot), "utf8");
  const sourceFavicon = await readFile(new URL("brand/favicon.svg", artifactRoot), "utf8");
  const approvedFavicon = await readFile(
    new URL("../../../../attached_assets/fevicon_1788696519503.png", import.meta.url),
  );
  const sourceFaviconPng = await readFile(new URL("brand/favicon.png", artifactRoot));
  const publicFavicon = await readFile(new URL("public/favicon.png", artifactRoot));
  const faviconIco = await readFile(new URL("public/favicon.ico", artifactRoot));
  const favicon = await readFile(new URL("public/favicon.svg", artifactRoot), "utf8");
  const socialCard = await readFile(new URL("public/social-card.svg", artifactRoot), "utf8");
  const brandComponent = await readFile(new URL("src/components/brand-logo.tsx", artifactRoot), "utf8");
  const layout = await readFile(new URL("src/components/layout.tsx", artifactRoot), "utf8");
  const loginPage = await readFile(new URL("src/pages/login.tsx", artifactRoot), "utf8");
  const adminLogin = await readFile(new URL("src/pages/admin-login.tsx", artifactRoot), "utf8");
  const designSystemFavicon = await readFile(
    new URL("../../../wealthone-design-system/public/favicon.svg", import.meta.url),
    "utf8",
  );
  const designSystemHtml = await readFile(
    new URL("../../../wealthone-design-system/index.html", import.meta.url),
    "utf8",
  );
  assert.match(sourceMark, /data-brand-mark="r-growth-bars-v1"/);
  assert.deepEqual(publicFavicon, sourceFaviconPng);
  const embeddedFavicon = sourceFavicon.match(/href="data:image\/png;base64,([^"]+)"/)?.[1];
  assert.ok(embeddedFavicon, "canonical favicon embeds the supplied artwork");
  assert.deepEqual(Buffer.from(embeddedFavicon, "base64"), approvedFavicon);
  assert.match(sourceFavicon, /data-brand-mark="r-growth-arc-glossy-supplied-v1"/);
  assert.match(
    sourceFavicon,
    new RegExp(`data-source-sha256="${createHash("sha256").update(approvedFavicon).digest("hex")}"`),
  );
  assert.match(favicon, /GENERATED from attached_assets\/fevicon_1788696519503\.png/);
  assert.match(favicon, /<title>ezyRetire favicon<\/title>/);
  assert.match(favicon, /data-brand-mark="r-growth-arc-glossy-supplied-v1"/);
  assert.match(socialCard, /data-brand-mark="r-growth-bars-v1"/);
  assert.match(designSystemFavicon, /data-brand-mark="r-growth-arc-glossy-supplied-v1"/);
  assert.match(
    designSystemHtml,
    /href="\/favicon-dark\.png" media="\(prefers-color-scheme: dark\)"/,
  );
  assert.doesNotMatch(brandComponent, /app-mark\.svg/);
  assert.match(brandComponent, /loader-icon-lightmode\.png/);
  assert.match(brandComponent, /loader-icon-darkmode\.png/);
  assert.match(brandComponent, /brand-logo\.png/);
  assert.match(brandComponent, /brand-logo-compact\.png/);
  assert.match(brandComponent, /brand-logo-compact-dark\.png/);
  assert.match(brandComponent, /alt="ezyRetire"/);
  assert.equal(layout.match(/<BrandLogo[\s\S]*?\bcompact\b[\s\S]*?\/>/g)?.length, 1);
  assert.match(
    loginPage,
    /import\s+\{\s*BrandLogo\s*\}\s+from\s+["']@\/components\/brand-logo["']/,
  );
  assert.ok(
    (loginPage.match(/<BrandLogo(?:\s+[^>]*)?\s*\/>/g) ?? []).length > 0,
    "login renders the canonical ezyRetire BrandLogo",
  );
  assert.doesNotMatch(loginPage, /<BrandLogo[^>]*\bcompact\b/);
  assert.match(adminLogin, /<BrandLoader className="animate-pulse" \/>/);
  assert.doesNotMatch(favicon, />W</);
  assert.equal(faviconIco.readUInt16LE(0), 0, "favicon.ico reserved header");
  assert.equal(faviconIco.readUInt16LE(2), 1, "favicon.ico image type");
  assert.equal(faviconIco.readUInt16LE(4), 1, "favicon.ico image count");
  assert.equal(faviconIco[6], 32, "favicon.ico width");
  assert.equal(faviconIco[7], 32, "favicon.ico height");

  for (const [file, width, height] of [
    ["favicon.png", 180, 180],
    ["favicon-32x32.png", 32, 32],
    ["favicon-dark.png", 180, 180],
    ["apple-touch-icon.png", 180, 180],
    ["icon-192.png", 192, 192],
    ["icon-512.png", 512, 512],
    ["icon-maskable-512.png", 512, 512],
    ["social-card.png", 1200, 630],
    ["brand-logo.png", 2167, 726],
    ["brand-logo-dark.png", 2172, 724],
    ["brand-logo-compact.png", 568, 152],
    ["brand-logo-compact-dark.png", 568, 152],
  ] as const) {
    const png = await readFile(new URL(`public/${file}`, artifactRoot));
    assert.equal(png.toString("ascii", 1, 4), "PNG", `${file} is a PNG`);
    assert.equal(png.readUInt32BE(16), width, `${file} width`);
    assert.equal(png.readUInt32BE(20), height, `${file} height`);
  }

  const suppliedLauncher = await readFile(
    new URL("../../../../attached_assets/mobile-app-icon-logo_1788990742871.png", import.meta.url),
  );
  const browserFavicon = await readFile(new URL("public/favicon.png", artifactRoot));
  const evidence = JSON.parse(
    await readFile(new URL("public/brand-assets.json", artifactRoot), "utf8"),
  ) as {
    approvedSources: Record<string, { file: string; sha256: string }>;
    launcherCropChecks: Array<{ shape: string; preservesCriticalArtwork: boolean }>;
    assets: Array<{
      file: string;
      width: number;
      height: number;
      purpose: string;
      sourceMarker: string;
      sha256: string;
    }>;
  };
  const sourceMarker = "ezyretire-black-silver-launcher-supplied-v2";
  const launcherAssets = evidence.assets.filter(({ sourceMarker: marker }) => marker === sourceMarker);
  const approvedLauncher = evidence.approvedSources[sourceMarker];

  assert.equal(approvedLauncher.file, "attached_assets/mobile-app-icon-logo_1788990742871.png");
  assert.equal(
    approvedLauncher.sha256,
    createHash("sha256").update(suppliedLauncher).digest("hex"),
  );
  assert.notDeepEqual(browserFavicon, suppliedLauncher, "browser favicon remains a distinct approved asset");
  assert.deepEqual(
    launcherAssets.map(({ file, width, height, purpose }) => ({ file, width, height, purpose })),
    [
      { file: "apple-touch-icon.png", width: 180, height: 180, purpose: "apple-touch-and-splash" },
      { file: "icon-192.png", width: 192, height: 192, purpose: "any" },
      { file: "icon-512.png", width: 512, height: 512, purpose: "any" },
      { file: "icon-maskable-512.png", width: 512, height: 512, purpose: "maskable" },
    ],
  );
  for (const asset of launcherAssets) {
    const output = await readFile(new URL(`public/${asset.file}`, artifactRoot));
    assert.equal(createHash("sha256").update(output).digest("hex"), asset.sha256);
  }
  assert.deepEqual(evidence.launcherCropChecks, [
    { shape: "circle", preservesCriticalArtwork: true },
    { shape: "squircle", preservesCriticalArtwork: true },
    { shape: "rounded-square", preservesCriticalArtwork: true },
  ]);
});

test("favicon visual regression coverage uses production assets at browser sizes", async () => {
  const fixture = await readFile(
    new URL("e2e/fixtures/favicon-visual.html", artifactRoot),
    "utf8",
  );
  const visualTest = await readFile(
    new URL("e2e/favicon-visual.spec.ts", artifactRoot),
    "utf8",
  );
  assert.match(fixture, /class="icon--16" src="\/favicon\.svg"/);
  assert.match(fixture, /class="icon--32" src="\/favicon-32x32\.png"/);
  assert.equal(fixture.match(/<section class="chrome chrome--light"/g)?.length, 1);
  assert.equal(fixture.match(/<section class="chrome chrome--dark"/g)?.length, 1);
  assert.match(visualTest, /toHaveScreenshot\("favicon-browser-sizes\.png"/);
});
