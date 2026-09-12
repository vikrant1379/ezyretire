import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(root, "../..");
const publicDir = join(root, "public");
const source = readFileSync(join(root, "brand", "mark.svg"));
const evidence = JSON.parse(readFileSync(join(publicDir, "brand-assets.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(publicDir, "site.webmanifest"), "utf8"));

assert.match(source.toString(), /data-brand-mark="r-growth-bars-v1"/);
const approvedSourcePaths = {
  "r-growth-bars-v1": join(root, "brand", "mark.svg"),
  "r-growth-arc-glossy-supplied-v1": join(
    workspaceRoot,
    "attached_assets",
    "fevicon_1788696519503.png",
  ),
  "ezyretire-black-silver-launcher-supplied-v2": join(
    workspaceRoot,
    "attached_assets",
    "mobile-app-icon-logo_1788990742871.png",
  ),
  "ezyretire-light-horizontal-logo-supplied-v1": join(
    workspaceRoot,
    "attached_assets",
    "light-mode-hz_1789063924461.png",
  ),
  "ezyretire-dark-horizontal-logo-supplied-v1": join(
    workspaceRoot,
    "attached_assets",
    "dark-mode-hz_1789063919926.png",
  ),
  "ezyretire-golden-dark-loader-mark-supplied-v1": join(
    workspaceRoot,
    "attached_assets",
    "lodericon-darkmode_1788994352024.png",
  ),
};
for (const [marker, sourceEvidence] of Object.entries(evidence.approvedSources)) {
  assert.ok(approvedSourcePaths[marker], `unexpected approved source marker ${marker}`);
  assert.equal(
    sourceEvidence.sha256,
    createHash("sha256").update(readFileSync(approvedSourcePaths[marker])).digest("hex"),
    `${marker} approved source`,
  );
}

function dimensions(bytes, file) {
  if (file.endsWith(".png")) {
    assert.equal(bytes.subarray(1, 4).toString(), "PNG", `${file} must be a PNG`);
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  const svg = bytes.toString();
  return [
    Number(svg.match(/\bwidth="(\d+)"/)?.[1]),
    Number(svg.match(/\bheight="(\d+)"/)?.[1]),
  ];
}

for (const asset of evidence.assets) {
  const bytes = readFileSync(join(publicDir, asset.file));
  assert.deepEqual(dimensions(bytes, asset.file), [asset.width, asset.height], `${asset.file} dimensions`);
  assert.ok(evidence.approvedSources[asset.sourceMarker], `${asset.file} approved source marker`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, `${asset.file} approved bytes`);
}

for (const icon of manifest.icons) {
  const asset = evidence.assets.find(({ file }) => `/${file}` === icon.src);
  assert.ok(asset, `${icon.src} must have generated brand evidence`);
  assert.equal(icon.sizes, `${asset.width}x${asset.height}`);
  assert.equal(icon.purpose, asset.purpose);
}
assert.ok(evidence.assets.some(({ purpose }) => purpose === "apple-touch-and-splash"));
assert.deepEqual(evidence.launcherCropChecks, [
  { shape: "circle", preservesCriticalArtwork: true },
  { shape: "squircle", preservesCriticalArtwork: true },
  { shape: "rounded-square", preservesCriticalArtwork: true },
]);
process.stdout.write(`Verified ${evidence.assets.length} generated brand/PWA assets and approved source provenance.\n`);