import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactRoot = new URL("../../", import.meta.url);

test("discovery metadata consistently identifies ezyRetire and its canonical domain", async () => {
  const html = await readFile(new URL("index.html", artifactRoot), "utf8");
  const manifest = JSON.parse(
    await readFile(new URL("public/site.webmanifest", artifactRoot), "utf8"),
  ) as { name: string; start_url: string; icons: Array<{ src: string; sizes: string }> };
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
  assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ["192x192", "512x512", "512x512"]);
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
  const appMark = await readFile(new URL("public/app-mark.svg", artifactRoot), "utf8");
  const socialCard = await readFile(new URL("public/social-card.svg", artifactRoot), "utf8");
  const brandComponent = await readFile(new URL("src/components/brand-logo.tsx", artifactRoot), "utf8");
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
  assert.match(appMark, /data-brand-mark="r-growth-bars-v1"/);
  assert.match(socialCard, /data-brand-mark="r-growth-bars-v1"/);
  assert.match(designSystemFavicon, /data-brand-mark="r-growth-arc-glossy-supplied-v1"/);
  assert.match(
    designSystemHtml,
    /href="\/favicon-dark\.png" media="\(prefers-color-scheme: dark\)"/,
  );
  assert.match(brandComponent, /app-mark\.svg/);
  assert.match(brandComponent, /brand-logo\.png/);
  assert.match(brandComponent, /alt="ezyRetire"/);
  assert.match(await readFile(new URL("src/App.tsx", artifactRoot), "utf8"), /<BrandLogo className="mx-auto mb-6 h-28 max-w-full" \/>/);
  assert.match(adminLogin, /<BrandMark className="h-10 w-10" decorative \/>/);
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
    ["brand-logo.png", 864, 748],
  ] as const) {
    const png = await readFile(new URL(`public/${file}`, artifactRoot));
    assert.equal(png.toString("ascii", 1, 4), "PNG", `${file} is a PNG`);
    assert.equal(png.readUInt32BE(16), width, `${file} width`);
    assert.equal(png.readUInt32BE(20), height, `${file} height`);
  }
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