import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const fontsDirectory = path.resolve(scriptDirectory, '../public/fonts');
const workspaceDirectory = path.resolve(scriptDirectory, '../../..');

const dmSerifRequiredUnicodeRanges =
  'U+000D,U+0020-007E,U+00A0-0107,U+010C-0113,U+0116-011B,U+011E-011F,U+0122-0123,U+012A-012B,U+012E-0131,U+0136-0137,U+0139-0148,U+014C-014D,U+0150-015B,U+015E-0165,U+016A-016B,U+016E-0173,U+0178-017E,U+0218-021B,U+2013-2014,U+2018-201A,U+201C-201E,U+2020-2022,U+2026,U+2030,U+2039-203A,U+2044,U+20AC,U+20BD,U+2122,U+212E';

const interRequiredUnicodeRanges =
  'U+0000,U+0020-007E,U+00A0-00AC,U+00AE-0148,U+014A-01C3,U+01C5-024F,U+1E00-1E9B,U+1E9D-1EFF,U+2000-200B,U+2010-2027,U+202F-2055,U+2057,U+205F,U+20A0-20AF,U+20B1-20B5,U+20B8-20BA,U+20BC-20BF,U+2100-2101,U+2103,U+2105-2106,U+2109,U+2113,U+2116-2117,U+211E-2122,U+2126,U+212A-212B,U+212E,U+2132,U+213B,U+214D,U+2190-2199,U+21A9-21AA,U+21B0-21B1,U+21B3-21B5,U+21BA-21BB,U+21D0,U+21D2,U+21D4,U+21DE-21DF,U+21E4-21E5,U+21E7,U+21EA,U+25A0-25A2,U+25AA,U+25B2-25B3,U+25B6-25B7,U+25BA-25BD,U+25C0-25C1,U+25C4-25C7,U+25CA-25CB,U+25CF,U+25E6,U+25EF,U+2600,U+2605-2606,U+263C,U+2661,U+2665,U+26A0,U+2713,U+2717,U+2756,U+2764,U+2780-2788';

export const faces = [
  {
    fileName: 'dm-serif-display-400',
    family: 'DM Serif Display',
    weight: 400,
    requiredGlyphs: 'Plan — “Résumé” Español',
    requiredUnicodeRanges: dmSerifRequiredUnicodeRanges,
    requiredCodePointCount: 303,
  },
  {
    fileName: 'inter-400',
    family: 'Inter',
    weight: 400,
    requiredGlyphs: '₹ $ € £ ¥ 1,234.56 — “Résumé” Español',
    requiredUnicodeRanges: interRequiredUnicodeRanges,
    requiredCodePointCount: 977,
  },
  {
    fileName: 'inter-500',
    family: 'Inter',
    weight: 500,
    requiredGlyphs: '₹ $ € £ ¥ 1,234.56 — “Résumé” Español',
    requiredUnicodeRanges: interRequiredUnicodeRanges,
    requiredCodePointCount: 977,
  },
  {
    fileName: 'inter-600',
    family: 'Inter',
    weight: 600,
    requiredGlyphs: '₹ $ € £ ¥ 1,234.56 — “Résumé” Español',
    requiredUnicodeRanges: interRequiredUnicodeRanges,
    requiredCodePointCount: 977,
  },
  {
    fileName: 'inter-700',
    family: 'Inter',
    weight: 700,
    requiredGlyphs: '₹ $ € £ ¥ 1,234.56 — “Résumé” Español',
    requiredUnicodeRanges: interRequiredUnicodeRanges,
    requiredCodePointCount: 977,
  },
];

const licenses = ['INTER-LICENSE.txt', 'DM-SERIF-DISPLAY-LICENSE.txt'];
const generatedFiles = [
  ...faces.map(({ fileName }) => `${fileName}.woff2`),
  ...licenses,
  'fonts.css',
];

function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      stdio: 'inherit',
      ...options,
    });
    child.once('error', (error) => {
      reject(
        new Error(
          `Could not run ${command}. The locked font toolchain is unavailable; run the repository's managed dependency setup.`,
          { cause: error },
        ),
      );
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited ${signal ? `after signal ${signal}` : `with code ${code}`}.`,
        ),
      );
    });
  });
}

function fontToolsInvocation(pyftsubset) {
  if (pyftsubset) {
    return { command: pyftsubset, argumentsPrefix: [] };
  }
  return {
    command: 'uv',
    argumentsPrefix: [
      'run',
      '--frozen',
      '--project',
      workspaceDirectory,
      'pyftsubset',
    ],
  };
}

function runFontTools(arguments_, pyftsubset) {
  const { command, argumentsPrefix } = fontToolsInvocation(pyftsubset);
  return run(command, [...argumentsPrefix, ...arguments_], {
    cwd: fontsDirectory,
  });
}

async function assertFile(filePath) {
  await access(filePath, constants.R_OK);
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function unicodeContract() {
  return Object.fromEntries(
    faces.map((face) => [
      face.fileName,
      {
        requiredCodePointCount: face.requiredCodePointCount,
        requiredUnicodeRanges: face.requiredUnicodeRanges,
      },
    ]),
  );
}

async function writeVersionManifest(directory, sourceName) {
  const assets = {};
  for (const fileName of generatedFiles) {
    assets[fileName] = await sha256(path.join(directory, fileName));
  }
  await writeFile(
    path.join(directory, 'font-manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        source: sourceName,
        unicodeContract: unicodeContract(),
        assets,
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  );
}

async function verifyVersionManifest(directory) {
  const manifestPath = path.join(directory, 'font-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    manifest.schemaVersion !== 1 ||
    JSON.stringify(manifest.unicodeContract) !== JSON.stringify(unicodeContract())
  ) {
    throw new Error(
      `${manifestPath} does not match the checked-in Unicode contract.`,
    );
  }
  const manifestFiles = Object.keys(manifest.assets ?? {}).sort();
  if (JSON.stringify(manifestFiles) !== JSON.stringify([...generatedFiles].sort())) {
    throw new Error(`${manifestPath} does not list the complete generated asset set.`);
  }
  for (const fileName of generatedFiles) {
    const actual = await sha256(path.join(directory, fileName));
    if (manifest.assets[fileName] !== actual) {
      throw new Error(
        `${fileName} does not match its immutable version manifest checksum.`,
      );
    }
  }
}

export async function verifyFontDirectory(directory, pyftsubset) {
  const verificationDirectory = await mkdtemp(
    path.join(tmpdir(), 'ezyretire-font-verification-'),
  );
  try {
    await verifyVersionManifest(directory);
    for (const face of faces) {
      const input = path.join(directory, `${face.fileName}.woff2`);
      await assertFile(input);
      await runFontTools(
        [
          input,
          `--text=${face.requiredGlyphs}`,
          `--unicodes=${face.requiredUnicodeRanges}`,
          '--no-ignore-missing-unicodes',
          `--output-file=${path.join(verificationDirectory, `${face.fileName}.woff2`)}`,
          '--flavor=woff2',
        ],
        pyftsubset,
      );
    }
    for (const license of licenses) {
      await assertFile(path.join(directory, license));
    }
  } finally {
    await rm(verificationDirectory, { recursive: true, force: true });
  }
}

function stylesheet() {
  const rules = faces.map(
    (face) => `@font-face {
  font-family: "${face.family}";
  font-style: normal;
  font-weight: ${face.weight};
  font-display: swap;
  src: url("./${face.fileName}.woff2") format("woff2");
}`,
  );
  return `/*
 * EzyRetire typography, self-hosted under the SIL Open Font License 1.1.
 * Generated by pnpm fonts:build; do not edit this version in place.
 * See the license files in this directory.
 */
${rules.join('\n\n')}
`;
}

export async function buildFontVersion({
  sourceName,
  targetName,
  pyftsubset,
}) {
  if (!/^ezyretire-v[1-9]\d*$/.test(sourceName)) {
    throw new Error(`Invalid source version directory "${sourceName}".`);
  }
  if (!/^ezyretire-v[1-9]\d*$/.test(targetName)) {
    throw new Error(`Invalid target version directory "${targetName}".`);
  }

  const sourceDirectory = path.join(fontsDirectory, sourceName);
  const targetDirectory = path.join(fontsDirectory, targetName);
  for (const face of faces) {
    await assertFile(path.join(sourceDirectory, `${face.fileName}.ttf`));
  }
  for (const license of licenses) {
    await assertFile(path.join(sourceDirectory, license));
  }

  await mkdir(targetDirectory);
  try {
    for (const face of faces) {
      await runFontTools(
        [
          path.join(sourceDirectory, `${face.fileName}.ttf`),
          `--text=${face.requiredGlyphs}`,
          `--unicodes=${face.requiredUnicodeRanges}`,
          '--no-ignore-missing-unicodes',
          '--layout-features=*',
          '--glyph-names',
          '--symbol-cmap',
          '--legacy-cmap',
          '--notdef-glyph',
          '--notdef-outline',
          '--recommended-glyphs',
          '--name-IDs=*',
          '--name-legacy',
          '--name-languages=*',
          '--flavor=woff2',
          `--output-file=${path.join(targetDirectory, `${face.fileName}.woff2`)}`,
        ],
        pyftsubset,
      );
    }
    for (const license of licenses) {
      await copyFile(
        path.join(sourceDirectory, license),
        path.join(targetDirectory, license),
        constants.COPYFILE_EXCL,
      );
    }
    await writeFile(path.join(targetDirectory, 'fonts.css'), stylesheet(), {
      flag: 'wx',
    });
    await writeVersionManifest(targetDirectory, sourceName);
    await verifyFontDirectory(targetDirectory, pyftsubset);
  } catch (error) {
    await rm(targetDirectory, { recursive: true, force: true });
    throw error;
  }
  return targetDirectory;
}

function parseArguments(arguments_) {
  arguments_ = arguments_.filter((argument) => argument !== '--');
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!['--source', '--target', '--verify'].includes(option) || !value) {
      throw new Error(
        'Usage: pnpm fonts:build -- --source ezyretire-v1 --target ezyretire-v4, or pnpm fonts:verify -- --verify ezyretire-v3',
      );
    }
    values.set(option, value);
  }
  return values;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const verifyName = arguments_.get('--verify');
  if (verifyName) {
    if (!/^ezyretire-v[1-9]\d*$/.test(verifyName)) {
      throw new Error(`Invalid version directory "${verifyName}".`);
    }
    await verifyFontDirectory(path.join(fontsDirectory, verifyName));
    console.log(`Verified required glyphs and licenses in ${verifyName}.`);
    return;
  }

  const sourceName = arguments_.get('--source');
  const targetName = arguments_.get('--target');
  if (!sourceName || !targetName) {
    throw new Error('Both --source and --target are required.');
  }
  await buildFontVersion({
    sourceName,
    targetName,
  });
  console.log(`Created and verified immutable font version ${targetName}.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      `Font build failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}