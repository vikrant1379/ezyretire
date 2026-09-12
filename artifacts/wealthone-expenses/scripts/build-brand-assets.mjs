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
const approvedLogoPath = join(
  workspaceRoot,
  "attached_assets",
  "light-mode-hz_1789063924461.png",
);
const approvedDarkLogoPath = join(
  workspaceRoot,
  "attached_assets",
  "dark-mode-hz_1789063919926.png",
);
const approvedDarkPageMarkPath = join(
  workspaceRoot,
  "attached_assets",
  "lodericon-darkmode_1788994352024.png",
);
const approvedFaviconPath = join(
  workspaceRoot,
  "attached_assets",
  "fevicon_1788696519503.png",
);
const approvedLauncherPath = join(
  workspaceRoot,
  "attached_assets",
  "mobile-app-icon-logo_1788990742871.png",
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
const approvedFavicon = readFileSync(approvedFaviconPath);
const approvedFaviconIdentity = createHash("sha256").update(approvedFavicon).digest("hex");
const approvedLauncher = readFileSync(approvedLauncherPath);
const approvedLauncherIdentity = createHash("sha256").update(approvedLauncher).digest("hex");
const approvedDarkLogo = readFileSync(approvedDarkLogoPath);
const approvedDarkLogoIdentity = createHash("sha256").update(approvedDarkLogo).digest("hex");
const approvedDarkPageMark = readFileSync(approvedDarkPageMarkPath);
const approvedDarkPageMarkIdentity = createHash("sha256").update(approvedDarkPageMark).digest("hex");
const approvedLogo = readFileSync(approvedLogoPath);
const approvedLogoIdentity = createHash("sha256").update(approvedLogo).digest("hex");
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
write(join(publicDir, "loader-icon-darkmode.png"), approvedDarkPageMark);
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
const generatedDarkFullLogo = outputPath(join(publicDir, "brand-logo-dark.png"));
const generatedCompactLogo = outputPath(join(publicDir, "brand-logo-compact.png"));
const generatedCompactDarkLogo = outputPath(join(publicDir, "brand-logo-compact-dark.png"));

write(join(publicDir, "brand-logo.png"), approvedLogo);
write(join(publicDir, "brand-logo-dark.png"), approvedDarkLogo);
const compactSourceArguments = (sourcePath) => [
  sourcePath,
  "-alpha",
  "on",
  "-fuzz",
  "20%",
  "-transparent",
  "#0d1117",
  "-trim",
  "+repage",
  "-resize",
  "568x152",
  "-gravity",
  "center",
  "-background",
  "none",
  "-extent",
  "568x152",
];
execFileSync("magick", [
  ...compactSourceArguments(approvedLogoPath),
  "-strip",
  `PNG32:${generatedCompactLogo}`,
]);
execFileSync("magick", [
  ...compactSourceArguments(approvedDarkLogoPath),
  "-strip",
  `PNG32:${generatedCompactDarkLogo}`,
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
  render(approvedLauncherPath, outputPath(join(publicDir, name)), width, height);
}
execFileSync("magick", [
  "-size",
  "512x512",
  "xc:black",
  "(",
  approvedLauncherPath,
  "-resize",
  "410x410!",
  ")",
  "-gravity",
  "center",
  "-composite",
  "-strip",
  `PNG32:${outputPath(join(publicDir, "icon-maskable-512.png"))}`,
]);

const launcherCropChecks = [
  ["circle", "circle 256,256 256,10"],
  ["squircle", "roundrectangle 20,20 492,492 150,150"],
  ["rounded-square", "roundrectangle 8,8 504,504 72,72"],
];
const launcherCropCheckDir = mkdtempSync(join(tmpdir(), "ezyretire-launcher-crops-"));
const criticalArtworkMask = join(launcherCropCheckDir, "critical-artwork.png");
execFileSync("magick", [
  outputPath(join(publicDir, "icon-maskable-512.png")),
  "-alpha",
  "off",
  "-fx",
  "(r+g+b)/3>0.2?1:0",
  criticalArtworkMask,
]);
for (const [shape, draw] of launcherCropChecks) {
  const cropMask = join(launcherCropCheckDir, `${shape}-mask.png`);
  const croppedArtwork = join(launcherCropCheckDir, `${shape}-critical-artwork.png`);
  execFileSync("magick", [
    "-size",
    "512x512",
    "xc:black",
    "-fill",
    "white",
    "-draw",
    draw,
    cropMask,
  ]);
  execFileSync("magick", [
    criticalArtworkMask,
    cropMask,
    "-compose",
    "Multiply",
    "-composite",
    croppedArtwork,
  ]);
  try {
    execFileSync(
      "magick",
      ["compare", "-metric", "AE", criticalArtworkMask, croppedArtwork, "null:"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch {
    rmSync(launcherCropCheckDir, { recursive: true, force: true });
    throw new Error(
      `The supplied launcher artwork is clipped by the representative ${shape} launcher crop`,
    );
  }
}
rmSync(launcherCropCheckDir, { recursive: true, force: true });
render(generatedSocial, outputPath(join(publicDir, "social-card.png")), 1200, 630);
render(approvedFaviconPath, outputPath(join(designPublicDir, "favicon-dark.png")), 180, 180);

execFileSync("magick", [
  outputPath(join(publicDir, "favicon-32x32.png")),
  "-strip",
  outputPath(join(publicDir, "favicon.ico")),
]);

const brandSourceMarker = "r-growth-bars-v1";
const launcherSourceMarker = "ezyretire-black-silver-launcher-supplied-v2";
const lightLogoSourceMarker = "ezyretire-light-horizontal-logo-supplied-v1";
const darkLogoSourceMarker = "ezyretire-dark-horizontal-logo-supplied-v1";
const darkPageMarkSourceMarker = "ezyretire-golden-dark-loader-mark-supplied-v1";
const brandSourceSha256 = createHash("sha256").update(source).digest("hex");
const verifiedIconTargets = [
  ["favicon.svg", 180, 180, "browser", "r-growth-arc-glossy-supplied-v1"],
  ["favicon-32x32.png", 32, 32, "browser", "r-growth-arc-glossy-supplied-v1"],
  ["favicon.png", 180, 180, "browser", "r-growth-arc-glossy-supplied-v1"],
  ["apple-touch-icon.png", 180, 180, "apple-touch-and-splash", launcherSourceMarker],
  ["icon-192.png", 192, 192, "any", launcherSourceMarker],
  ["icon-512.png", 512, 512, "any", launcherSourceMarker],
  ["icon-maskable-512.png", 512, 512, "maskable", launcherSourceMarker],
  ["brand-logo.png", 2167, 726, "in-app-light-full-logo", lightLogoSourceMarker],
  ["brand-logo-dark.png", 2172, 724, "in-app-dark-full-logo", darkLogoSourceMarker],
  ["loader-icon-darkmode.png", 1278, 1230, "in-app-dark-page-mark", darkPageMarkSourceMarker],
  ["brand-logo-compact.png", 568, 152, "compact-navigation-light-full-logo", lightLogoSourceMarker],
  ["brand-logo-compact-dark.png", 568, 152, "compact-navigation-dark-full-logo", darkLogoSourceMarker],
];
const brandAssetEvidence = {
  schemaVersion: 1,
  approvedSources: {
    [brandSourceMarker]: {
      file: "brand/mark.svg",
      sha256: brandSourceSha256,
    },
    "r-growth-arc-glossy-supplied-v1": {
      file: "attached_assets/fevicon_1788696519503.png",
      sha256: approvedFaviconIdentity,
    },
    [launcherSourceMarker]: {
      file: "attached_assets/mobile-app-icon-logo_1788990742871.png",
      sha256: approvedLauncherIdentity,
    },
    [lightLogoSourceMarker]: {
      file: "attached_assets/light-mode-hz_1789063924461.png",
      sha256: approvedLogoIdentity,
    },
    [darkLogoSourceMarker]: {
      file: "attached_assets/dark-mode-hz_1789063919926.png",
      sha256: approvedDarkLogoIdentity,
    },
    [darkPageMarkSourceMarker]: {
      file: "attached_assets/lodericon-darkmode_1788994352024.png",
      sha256: approvedDarkPageMarkIdentity,
    },
  },
  launcherCropChecks: launcherCropChecks.map(([shape]) => ({
    shape,
    preservesCriticalArtwork: true,
  })),
  assets: verifiedIconTargets.map(([name, width, height, purpose, sourceMarker]) => {
    const generatedPath = outputPath(join(publicDir, name));
    return {
      file: name,
      width,
      height,
      purpose,
      sourceMarker,
      sha256: createHash("sha256").update(readFileSync(generatedPath)).digest("hex"),
    };
  }),
};
write(
  join(publicDir, "brand-assets.json"),
  `${JSON.stringify(brandAssetEvidence, null, 2)}\n`,
);

const generated = [
  "artifacts/wealthone-expenses/index.html",
  "artifacts/wealthone-expenses/brand/favicon.svg",
  "artifacts/wealthone-expenses/public/favicon.svg",
  "artifacts/wealthone-expenses/brand/favicon.png",
  "artifacts/wealthone-expenses/public/favicon.png",
  "artifacts/wealthone-expenses/public/brand-logo.png",
  "artifacts/wealthone-expenses/public/brand-logo-dark.png",
  "artifacts/wealthone-expenses/public/loader-icon-darkmode.png",
  "artifacts/wealthone-expenses/public/brand-logo-compact.png",
  "artifacts/wealthone-expenses/public/brand-logo-compact-dark.png",
  "artifacts/wealthone-expenses/public/social-card.svg",
  ...rasterTargets.map(([name]) => `artifacts/wealthone-expenses/public/${name}`),
  ...appIconTargets.map(([name]) => `artifacts/wealthone-expenses/public/${name}`),
  "artifacts/wealthone-expenses/public/icon-maskable-512.png",
  "artifacts/wealthone-expenses/public/social-card.png",
  "artifacts/wealthone-expenses/public/favicon.ico",
  "artifacts/wealthone-expenses/public/brand-assets.json",
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
    `Generated ${generated.length} brand assets from the approved logo, favicon, and mobile launcher artwork.\n`,
  );
}