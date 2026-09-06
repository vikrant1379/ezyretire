import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(root, "../..");
const sourcePath = join(root, "brand", "mark.svg");
const faviconSvgPath = join(root, "brand", "favicon.svg");
const appMarkSourcePath = join(root, "brand", "app-mark.svg");
const approvedLogoPath = join(
  workspaceRoot,
  "attached_assets",
  "ezyretire_retirement_logo_e7b96b508c8c408297211d518ad9beaf_1788599942322.png",
);
const approvedFaviconPath = join(
  workspaceRoot,
  "attached_assets",
  "fevicon_1788696519503.png",
);
const publicDir = join(root, "public");
const indexPath = join(root, "index.html");
const designPublicDir = join(workspaceRoot, "artifacts", "wealthone-design-system", "public");
const check = process.argv.includes("--check");

// ImageMagick 7 is absent from most CI images, so the staleness check cannot
// regenerate assets there. The committed outputs are verified on machines that
// do have it; set FORCE_BRAND_CHECK=1 to require it.
if (check && !process.env.FORCE_BRAND_CHECK) {
  try {
    execFileSync("magick", ["-version"], { stdio: "ignore" });
  } catch {
    process.stdout.write("Skipping brand check: ImageMagick 'magick' not available.\n");
    process.exit(0);
  }
}

const outputRoot = check ? mkdtempSync(join(tmpdir(), "ezyretire-brand-")) : workspaceRoot;

const source = readFileSync(sourcePath, "utf8");
const appMarkSource = readFileSync(appMarkSourcePath, "utf8");
const approvedFavicon = readFileSync(approvedFaviconPath);
const approvedFaviconIdentity = createHash("sha256").update(approvedFavicon).digest("hex");
const faviconSource = `<svg width="180" height="180" viewBox="0 0 1254 1254" xmlns="http://www.w3.org/2000/svg" data-brand-mark="r-growth-arc-glossy-supplied-v1" data-source-sha256="${approvedFaviconIdentity}">
  <title>ezyRetire favicon</title>
  <image width="1254" height="1254" href="data:image/png;base64,${approvedFavicon.toString("base64")}"/>
</svg>
`;
if (!source.includes('data-brand-mark="r-growth-bars-v1"')) {
  throw new Error("brand/mark.svg must retain the approved R with growth bars identity marker");
}

const outputPath = (absolutePath) =>
  join(outputRoot, absolutePath.slice(workspaceRoot.length + 1));
const write = (absolutePath, contents) => {
  const target = outputPath(absolutePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
};

const innerMark = source
  .replace(/^<svg[^>]*>\s*/, "")
  .replace(/\s*<\/svg>\s*$/, "")
  .replace("<title>ezyRetire</title>", "");
const favicon = faviconSource.replace(
  "<svg ",
  "<!-- GENERATED from attached_assets/fevicon_1788696519503.png by scripts/build-brand-assets.mjs; do not edit. -->\n<svg ",
);
const faviconCacheIdentity = createHash("sha256").update(favicon).digest("hex").slice(0, 12);
const indexHtml = readFileSync(indexPath, "utf8").replace(
  /href="\/(favicon(?:-32x32\.png|\.svg|\.ico))(?:\?v=[a-f0-9]+)?"/g,
  `href="/$1?v=${faviconCacheIdentity}"`,
);
const socialCard = `<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <title>ezyRetire — Track, plan, retire</title>
  <defs>
    <linearGradient id="background" x1="92" y1="38" x2="1108" y2="592" gradientUnits="userSpaceOnUse"><stop stop-color="#312E81"/><stop offset="1" stop-color="#1E1B4B"/></linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(1010 80) rotate(135) scale(480)"><stop stop-color="#F59E0B" stop-opacity=".36"/><stop offset="1" stop-color="#F59E0B" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" rx="36" fill="url(#background)"/><rect width="1200" height="630" rx="36" fill="url(#glow)"/>
  <g transform="translate(88 72) scale(.733333)">${innerMark}</g>
  <text x="252" y="184" fill="#FFF7ED" font-family="Georgia, serif" font-size="82" font-weight="700">ezyRetire</text>
  <text x="92" y="355" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="56" font-weight="700">Your whole financial picture.</text>
  <text x="92" y="427" fill="#FDE68A" font-family="Inter, Arial, sans-serif" font-size="56" font-weight="700">One clearer retirement plan.</text>
  <text x="92" y="527" fill="#C7D2FE" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="500" letter-spacing="5">TRACK  •  PLAN  •  RETIRE</text>
</svg>
`;

write(faviconSvgPath, faviconSource);
write(join(publicDir, "favicon.svg"), favicon);
write(join(publicDir, "app-mark.svg"), appMarkSource);
write(indexPath, indexHtml);
write(join(publicDir, "social-card.svg"), socialCard);
write(join(designPublicDir, "favicon.svg"), favicon);

function render(svgPath, destination, width, height, background = "none") {
  mkdirSync(dirname(destination), { recursive: true });
  execFileSync("magick", [
    "-background",
    background,
    "-density",
    "384",
    svgPath,
    "-resize",
    `${width}x${height}!`,
    "-strip",
    `PNG32:${destination}`,
  ]);
}

const generatedSocial = outputPath(join(publicDir, "social-card.svg"));
const generatedFullLogo = outputPath(join(publicDir, "brand-logo.png"));

execFileSync("magick", [
  approvedLogoPath,
  "-fuzz",
  "3%",
  "-trim",
  "+repage",
  "-resize",
  "864x748!",
  "-strip",
  `PNG32:${generatedFullLogo}`,
]);
const rasterTargets = [
  ["favicon-32x32.png", 32, 32],
  ["favicon-dark.png", 180, 180],
];
const appIconTargets = [
  ["apple-touch-icon.png", 180, 180],
  ["icon-192.png", 192, 192],
  ["icon-512.png", 512, 512],
];
render(approvedFaviconPath, outputPath(join(root, "brand", "favicon.png")), 180, 180);
render(approvedFaviconPath, outputPath(join(publicDir, "favicon.png")), 180, 180);
for (const [name, width, height] of rasterTargets) {
  render(approvedFaviconPath, outputPath(join(publicDir, name)), width, height);
}
for (const [name, width, height] of appIconTargets) {
  render(sourcePath, outputPath(join(publicDir, name)), width, height);
}
execFileSync("magick", [
  "-background",
  "#FFFEFC",
  "-density",
  "384",
  sourcePath,
  "-resize",
  "360x360!",
  "-gravity",
  "center",
  "-extent",
  "512x512",
  "-strip",
  `PNG32:${outputPath(join(publicDir, "icon-maskable-512.png"))}`,
]);
render(generatedSocial, outputPath(join(publicDir, "social-card.png")), 1200, 630);
render(approvedFaviconPath, outputPath(join(designPublicDir, "favicon-dark.png")), 180, 180);

execFileSync("magick", [
  outputPath(join(publicDir, "favicon-32x32.png")),
  "-strip",
  outputPath(join(publicDir, "favicon.ico")),
]);

const generated = [
  "artifacts/wealthone-expenses/index.html",
  "artifacts/wealthone-expenses/brand/favicon.svg",
  "artifacts/wealthone-expenses/public/favicon.svg",
  "artifacts/wealthone-expenses/public/app-mark.svg",
  "artifacts/wealthone-expenses/brand/favicon.png",
  "artifacts/wealthone-expenses/public/favicon.png",
  "artifacts/wealthone-expenses/public/brand-logo.png",
  "artifacts/wealthone-expenses/public/social-card.svg",
  ...rasterTargets.map(([name]) => `artifacts/wealthone-expenses/public/${name}`),
  ...appIconTargets.map(([name]) => `artifacts/wealthone-expenses/public/${name}`),
  "artifacts/wealthone-expenses/public/icon-maskable-512.png",
  "artifacts/wealthone-expenses/public/social-card.png",
  "artifacts/wealthone-expenses/public/favicon.ico",
  "artifacts/wealthone-design-system/public/favicon.svg",
  "artifacts/wealthone-design-system/public/favicon-dark.png",
];

if (check) {
  const stale = generated.filter((relativePath) => {
    const committed = join(workspaceRoot, relativePath);
    const expected = join(outputRoot, relativePath);
    return !existsSync(committed) || !readFileSync(committed).equals(readFileSync(expected));
  });
  rmSync(outputRoot, { recursive: true, force: true });
  if (stale.length) {
    throw new Error(
      `Generated brand assets are stale:\n${stale.map((file) => `- ${file}`).join("\n")}\nRun pnpm --filter @workspace/wealthone-expenses brand:build.`,
    );
  }
  process.stdout.write("Brand assets are up to date.\n");
} else {
  process.stdout.write(
    `Generated ${generated.length} brand assets from brand/mark.svg and the supplied favicon artwork.\n`,
  );
}