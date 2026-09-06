import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { checkPublishedFavicons } from './check-published-favicons.mjs';

const html = `<!doctype html>
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=brand123">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=brand123">
<link rel="shortcut icon" href="/favicon.ico?v=brand123">`;
const fileNames = ['favicon.svg', 'favicon-32x32.png', 'favicon.ico'];

function contentHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function expectedRelease(cacheIdentity, content = 'image') {
  return {
    cacheIdentity,
    contentHashes: Object.fromEntries(
      fileNames.map((fileName) => [fileName, contentHash(content)]),
    ),
  };
}

function response(body, { contentType = 'text/html', url, status = 200 }) {
  const value = new Response(body, {
    status,
    headers: { 'content-type': contentType },
  });
  Object.defineProperty(value, 'url', { value: url });
  return value;
}

test('checks every published favicon with the shared cache identity', async () => {
  const requestedUrls = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    requestedUrls.push(url.href);
    if (url.pathname === '/') {
      return response(html, { url: url.href });
    }

    const contentTypes = {
      '/favicon.svg': 'image/svg+xml; charset=utf-8',
      '/favicon-32x32.png': 'image/png',
      '/favicon.ico': 'image/x-icon',
    };
    return response('image', {
      contentType: contentTypes[url.pathname],
      url: url.href,
    });
  };

  const result = await checkPublishedFavicons(
    'https://example.com/',
    fetchImpl,
    expectedRelease('brand123'),
  );

  assert.equal(result.cacheIdentity, 'brand123');
  assert.equal(result.favicons.length, 3);
  assert.deepEqual(
    requestedUrls.slice(1).map((url) => new URL(url).search),
    ['?v=brand123', '?v=brand123', '?v=brand123'],
  );
});

test('derives the expected identity from the current generated favicon', async () => {
  const assets = Object.fromEntries(
    await Promise.all(
      fileNames.map(async (fileName) => [
        fileName,
        await readFile(new URL(`../public/${fileName}`, import.meta.url)),
      ]),
    ),
  );
  const currentIdentity = createHash('sha256')
    .update(assets['favicon.svg'])
    .digest('hex')
    .slice(0, 12);
  const currentHtml = html.replaceAll('brand123', currentIdentity);
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/') {
      return response(currentHtml, { url: url.href });
    }
    return response(assets[url.pathname.slice(1)], {
      contentType:
        url.pathname === '/favicon.svg'
          ? 'image/svg+xml'
          : url.pathname.endsWith('.png')
            ? 'image/png'
            : 'image/x-icon',
      url: url.href,
    });
  };

  const result = await checkPublishedFavicons(
    'https://example.com/',
    fetchImpl,
  );

  assert.equal(result.cacheIdentity, currentIdentity);
});

test('fails clearly when deployment rewriting drops the cache identity', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/') {
      return response(html, { url: url.href });
    }
    return response('image', {
      contentType:
        url.pathname === '/favicon.svg'
          ? 'image/svg+xml'
          : url.pathname.endsWith('.png')
            ? 'image/png'
            : 'image/x-icon',
      url: `${url.origin}${url.pathname}`,
    });
  };

  await assert.rejects(
    checkPublishedFavicons(
      'https://example.com/',
      fetchImpl,
      expectedRelease('brand123'),
    ),
    /changed cache identity from "brand123" to "\(missing\)"/,
  );
});

test('fails when published favicon links disagree on cache identity', async () => {
  const mismatchedHtml = html.replace(
    'favicon.ico?v=brand123',
    'favicon.ico?v=stale456',
  );
  const fetchImpl = async (input) => {
    const url = new URL(input);
    return response(mismatchedHtml, { url: url.href });
  };

  await assert.rejects(
    checkPublishedFavicons(
      'https://example.com/',
      fetchImpl,
      expectedRelease('brand123'),
    ),
    /do not share one cache identity/,
  );
});

test('fails when every published favicon shares a stale identity', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    return response(html, { url: url.href });
  };

  await assert.rejects(
    checkPublishedFavicons(
      'https://example.com/',
      fetchImpl,
      expectedRelease('current456'),
    ),
    /cache identity "brand123" is stale; the current build expects "current456"/,
  );
});

test('fails when a current versioned URL serves stale favicon bytes', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/') {
      return response(html, { url: url.href });
    }
    return response(
      url.pathname === '/favicon-32x32.png' ? 'stale-image' : 'image',
      {
        contentType:
          url.pathname === '/favicon.svg'
            ? 'image/svg+xml'
            : url.pathname.endsWith('.png')
              ? 'image/png'
              : 'image/x-icon',
        url: url.href,
      },
    );
  };

  await assert.rejects(
    checkPublishedFavicons(
      'https://example.com/',
      fetchImpl,
      expectedRelease('brand123'),
    ),
    /Published favicon-32x32\.png content does not match the current build asset/,
  );
});