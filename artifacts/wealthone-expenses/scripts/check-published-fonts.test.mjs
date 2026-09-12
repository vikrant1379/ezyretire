import assert from 'node:assert/strict';
import test from 'node:test';

import { checkPublishedFonts } from './check-published-fonts.mjs';

const fontPaths = [
  '/fonts/ezyretire-v1/fonts.css',
  '/fonts/ezyretire-v1/dm-serif-display-400.ttf',
  '/fonts/ezyretire-v1/inter-400.ttf',
  '/fonts/ezyretire-v1/inter-500.ttf',
  '/fonts/ezyretire-v1/inter-600.ttf',
  '/fonts/ezyretire-v1/inter-700.ttf',
];

function response({
  url,
  status = 200,
  contentType,
  cacheControl = 'public, max-age=31536000, immutable',
}) {
  const value = new Response('asset', {
    status,
    headers: {
      'content-type': contentType,
      'cache-control': cacheControl,
    },
  });
  Object.defineProperty(value, 'url', { value: url });
  return value;
}

function successfulFetch(input) {
  const url = new URL(input);
  return response({
    url: url.href,
    contentType: url.pathname.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : 'font/ttf',
  });
}

test('checks the published versioned stylesheet and every font binary', async () => {
  const requestedPaths = [];
  const result = await checkPublishedFonts(
    'https://example.com/',
    async (input) => {
      requestedPaths.push(new URL(input).pathname);
      return successfulFetch(input);
    },
  );

  assert.deepEqual(requestedPaths, fontPaths);
  assert.equal(result.assets.length, fontPaths.length);
});

test('accepts case-insensitive directives, quoted max-age, and legacy TTF MIME', async () => {
  const result = await checkPublishedFonts(
    'https://example.com/app',
    async (input) => {
      const url = new URL(input);
      return response({
        url: url.href,
        contentType: url.pathname.endsWith('.css')
          ? 'text/css'
          : 'application/x-font-ttf',
        cacheControl: 'PUBLIC, MAX-AGE="31536001", IMMUTABLE',
      });
    },
  );

  assert.equal(result.assets.length, fontPaths.length);
});

test('identifies the exact asset and incorrect Cache-Control header', async () => {
  await assert.rejects(
    checkPublishedFonts('https://example.com/', async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/inter-500.ttf')) {
        return response({
          url: url.href,
          contentType: 'font/ttf',
          cacheControl: 'public, max-age=3600',
        });
      }
      return successfulFetch(input);
    }),
    /\/fonts\/ezyretire-v1\/inter-500\.ttf returned Cache-Control "public, max-age=3600"; expected public, max-age>=31536000, immutable/,
  );
});

test('rejects an incorrect content type with the exact asset and header', async () => {
  await assert.rejects(
    checkPublishedFonts('https://example.com/', async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/fonts.css')) {
        return response({
          url: url.href,
          contentType: 'text/html',
        });
      }
      return successfulFetch(input);
    }),
    /\/fonts\/ezyretire-v1\/fonts\.css returned Content-Type "text\/html"; expected text\/css/,
  );
});

test('rejects cross-origin delivery after redirects', async () => {
  await assert.rejects(
    checkPublishedFonts('https://example.com/', async (input) => {
      const url = new URL(input);
      return response({
        url: `https://cdn.example.net${url.pathname}`,
        contentType: url.pathname.endsWith('.css') ? 'text/css' : 'font/ttf',
      });
    }),
    /\/fonts\/ezyretire-v1\/fonts\.css was delivered from a different origin/,
  );
});

test('identifies the exact asset when its request fails', async () => {
  await assert.rejects(
    checkPublishedFonts('https://example.com/', async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/inter-700.ttf')) {
        return response({
          url: url.href,
          status: 404,
          contentType: 'text/html',
        });
      }
      return successfulFetch(input);
    }),
    /\/fonts\/ezyretire-v1\/inter-700\.ttf request failed: 404/,
  );
});