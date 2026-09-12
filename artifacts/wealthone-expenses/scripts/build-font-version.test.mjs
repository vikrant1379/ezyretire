import assert from 'node:assert/strict';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildFontVersion,
  faces,
  fontsDirectory,
  verifyFontDirectory,
} from './build-font-version.mjs';

function countCodePoints(ranges) {
  return ranges.split(',').reduce((count, range) => {
    const [start, end = start] = range
      .replace('U+', '')
      .split('-')
      .map((value) => Number.parseInt(value, 16));
    return count + end - start + 1;
  }, 0);
}

test('documents exact per-face language, punctuation, financial, and UI contracts', () => {
  assert.equal(faces.length, 5);
  assert.equal(faces[0].requiredCodePointCount, 303);
  assert.ok(
    faces.every(
      (face) =>
        countCodePoints(face.requiredUnicodeRanges) ===
        face.requiredCodePointCount,
    ),
  );
  assert.ok(
    faces
      .filter(({ family }) => family === 'Inter')
      .every(
        ({ requiredGlyphs, requiredUnicodeRanges, requiredCodePointCount }) =>
          requiredGlyphs.includes('₹') &&
          requiredUnicodeRanges.includes('U+20B8-20BA') &&
          requiredUnicodeRanges.includes('U+1E9D-1EFF') &&
          requiredUnicodeRanges.includes('U+2190-2199') &&
          requiredCodePointCount === 977,
      ),
  );
});

test('rejects a font binary changed outside the immutable recipe', async () => {
  const sourceDirectory = path.join(fontsDirectory, 'ezyretire-v3');
  const directory = await mkdtemp(path.join(tmpdir(), 'ezyretire-font-tamper-'));
  try {
    for (const fileName of await readdir(sourceDirectory)) {
      await copyFile(
        path.join(sourceDirectory, fileName),
        path.join(directory, fileName),
      );
    }
    await writeFile(path.join(directory, 'inter-500.woff2'), 'tampered', {
      flag: 'a',
    });
    await assert.rejects(
      verifyFontDirectory(directory),
      /inter-500\.woff2 does not match its immutable version manifest checksum/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses to mutate an existing version directory', async () => {
  const targetName = `ezyretire-v${900_000_000 + process.pid}`;
  const targetDirectory = path.join(fontsDirectory, targetName);
  await mkdir(targetDirectory);
  const marker = path.join(targetDirectory, 'released-marker.txt');
  await writeFile(marker, 'do not change');
  try {
    await assert.rejects(
      buildFontVersion({
        sourceName: 'ezyretire-v1',
        targetName,
        pyftsubset: 'this-command-must-not-run',
      }),
      (error) => error?.code === 'EEXIST',
    );
    assert.equal(await readFile(marker, 'utf8'), 'do not change');
  } finally {
    await rm(targetDirectory, { recursive: true, force: true });
  }
});

test('removes a newly created version when conversion fails', async () => {
  const targetName = `ezyretire-v${910_000_000 + process.pid}`;
  const targetDirectory = path.join(fontsDirectory, targetName);
  await assert.rejects(
    buildFontVersion({
      sourceName: 'ezyretire-v1',
      targetName,
      pyftsubset: '/bin/false',
    }),
    /exited with code 1/,
  );
  await assert.rejects(access(targetDirectory), (error) => error?.code === 'ENOENT');
});

test('builds and verifies a complete version with the pinned toolchain', async () => {
  const targetName = `ezyretire-v${920_000_000 + process.pid}`;
  const targetDirectory = path.join(fontsDirectory, targetName);
  try {
    await buildFontVersion({
      sourceName: 'ezyretire-v1',
      targetName,
    });
    assert.deepEqual((await readdir(targetDirectory)).sort(), [
      'DM-SERIF-DISPLAY-LICENSE.txt',
      'INTER-LICENSE.txt',
      'dm-serif-display-400.woff2',
      'font-manifest.json',
      'fonts.css',
      'inter-400.woff2',
      'inter-500.woff2',
      'inter-600.woff2',
      'inter-700.woff2',
    ]);
    for (const license of [
      'DM-SERIF-DISPLAY-LICENSE.txt',
      'INTER-LICENSE.txt',
    ]) {
      assert.deepEqual(
        await readFile(path.join(targetDirectory, license)),
        await readFile(path.join(fontsDirectory, 'ezyretire-v1', license)),
      );
    }
    for (const fileName of await readdir(targetDirectory)) {
      assert.deepEqual(
        await readFile(path.join(targetDirectory, fileName)),
        await readFile(path.join(fontsDirectory, 'ezyretire-v3', fileName)),
        `${fileName} must be reproducible from the approved v1 sources`,
      );
    }
  } finally {
    await rm(targetDirectory, { recursive: true, force: true });
  }
});