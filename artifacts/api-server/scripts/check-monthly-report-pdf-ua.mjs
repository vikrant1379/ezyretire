import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const VERAPDF_VERSION = "1.30.2";
const VERAPDF_INSTALLER_SHA256 = "6cc6341cb1af644044054b81f00a6590a7918abb18f762243de115258bcad838";
const VERAPDF_INSTALLER_URL = "https://software.verapdf.org/rel/verapdf-installer.zip";
const cacheDir = join(homedir(), ".cache", "ezyretire-verapdf", VERAPDF_VERSION);
const executable = join(cacheDir, "verapdf");
const validationArgs = [
  "--format", "xml",
  "--flavour", "ua1",
  "--maxfailures", "-1",
  "--verbose",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with exit code ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function invokeVeraPdf(pdfPath) {
  const result = spawnSync(executable, [...validationArgs, pdfPath], { encoding: "utf8" });
  if (result.error) throw result.error;
  const compliance = result.stdout.match(/isCompliant="(true|false)"/)?.[1];
  return { ...result, compliance };
}

async function expectRejectedFixture(workDir, original, label, replacements) {
  let mutated = original;
  for (const [before, after] of replacements) {
    if (Buffer.byteLength(before, "latin1") !== Buffer.byteLength(after, "latin1")) {
      throw new Error(`${label} mutation must preserve byte offsets`);
    }
    if (!mutated.includes(before)) {
      throw new Error(`${label} mutation did not find ${before}`);
    }
    mutated = mutated.replaceAll(before, after);
  }
  const invalidPath = join(workDir, `invalid-${label}.pdf`);
  await writeFile(invalidPath, Buffer.from(mutated, "latin1"));
  const result = invokeVeraPdf(invalidPath);
  if (result.status !== 1 || result.compliance !== "false") {
    throw new Error([
      `veraPDF did not reject the ${label} regression as PDF/UA-1`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
}

async function ensureVeraPdf() {
  try {
    const version = run(executable, ["--version"]).stdout;
    if (version.includes(`veraPDF ${VERAPDF_VERSION}`)) return;
  } catch {
    // A missing or stale cache is replaced below.
  }

  const workDir = await mkdtemp(join(tmpdir(), "ezyretire-verapdf-install-"));
  try {
    const installerZip = join(workDir, "verapdf-installer.zip");
    const response = await fetch(VERAPDF_INSTALLER_URL);
    if (!response.ok) throw new Error(`Could not download veraPDF: HTTP ${response.status}`);
    await writeFile(installerZip, Buffer.from(await response.arrayBuffer()));
    const checksum = createHash("sha256").update(await readFile(installerZip)).digest("hex");
    if (checksum !== VERAPDF_INSTALLER_SHA256) {
      throw new Error(`veraPDF installer checksum changed: expected ${VERAPDF_INSTALLER_SHA256}, got ${checksum}`);
    }

    const unpacked = join(workDir, "installer");
    await mkdir(unpacked);
    run("unzip", ["-q", installerZip, "-d", unpacked]);
    const installerDir = join(unpacked, `verapdf-greenfield-${VERAPDF_VERSION}`);
    const installConfig = join(workDir, "auto-install.xml");
    await writeFile(installConfig, `<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>${cacheDir}</installpath></com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
    <pack index="0" name="veraPDF GUI" selected="true"/>
    <pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/>
    <pack index="2" name="veraPDF Validation model" selected="false"/>
    <pack index="3" name="veraPDF Documentation" selected="false"/>
    <pack index="4" name="veraPDF Sample Plugins" selected="false"/>
  </com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
`);
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(cacheDir, { recursive: true });
    const installer = join(installerDir, "verapdf-install");
    await chmod(installer, 0o755);
    run(installer, [installConfig], { stdio: "inherit" });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const artifactDir = join(scriptDir, "..");
const workDir = await mkdtemp(join(tmpdir(), "ezyretire-pdf-ua-"));
try {
  await ensureVeraPdf();
  const fixtureBundle = join(workDir, "fixture.mjs");
  const fixturePdf = join(workDir, "bilingual-monthly-report.pdf");
  await build({
    entryPoints: [join(artifactDir, "src/lib/monthly-report-pdf-ua.fixture.ts")],
    outfile: fixtureBundle,
    bundle: true,
    platform: "node",
    format: "esm",
    loader: { ".ttf": "base64" },
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });
  await copyFile(
    fileURLToPath(import.meta.resolve("harfbuzzjs/dist/harfbuzz.wasm")),
    join(workDir, "harfbuzz.wasm"),
  );
  run(process.execPath, [fixtureBundle, fixturePdf], { stdio: "inherit" });
  const pdfSource = await readFile(fixturePdf, "latin1");
  const objectBodies = [...pdfSource.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)]
    .map((match) => match[2]);
  const pageRefs = new Set([...pdfSource.matchAll(/(\d+) 0 obj\n<< \/Type \/Page\b/g)]
    .map((match) => match[1]));
  if (pageRefs.size < 2) throw new Error("PDF/UA fixture must contain multiple pages");
  const hasCrossPageContent = objectBodies
    .filter((body) => body.startsWith("<< /Type /StructElem"))
    .some((body) => new Set([...body.matchAll(/\/Pg (\d+) 0 R/g)]
      .map((match) => match[1])
      .filter((ref) => pageRefs.has(ref))).size > 1);
  if (!hasCrossPageContent) {
    throw new Error("PDF/UA fixture must include one structure element whose content crosses a page boundary");
  }

  const result = invokeVeraPdf(fixturePdf);
  if (result.status !== 0 || result.compliance !== "true") {
    throw new Error([
      `veraPDF rejected ${basename(fixturePdf)} as PDF/UA-1`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  await expectRejectedFixture(workDir, pdfSource, "parent-tree", [
    ["/StructParents ", "/StructParxnts "],
  ]);
  await expectRejectedFixture(workDir, pdfSource, "language", [
    ["/Lang ", "/Lxng "],
  ]);
  await expectRejectedFixture(workDir, pdfSource, "title", [
    ["/Title ", "/Thtle "],
    ["<dc:title>", "<dc:tihle>"],
    ["</dc:title>", "</dc:tihle>"],
  ]);
  await expectRejectedFixture(workDir, pdfSource, "heading-hierarchy", [
    ["/S /H1 ", "/S /H3 "],
  ]);
  await expectRejectedFixture(workDir, pdfSource, "list-structure", [
    ["/S /LI ", "/S /XX "],
  ]);
  const passedRules = result.stdout.match(/passedRules="(\d+)"/)?.[1] ?? "all";
  console.log(`veraPDF PDF/UA-1 validation passed (${passedRules} rules; 5 regression probes rejected).`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}