import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const FAVICONS = [
  {
    fileName: 'favicon.svg',
    rel: 'icon',
    expectedContentTypes: ['image/svg+xml'],
  },
  {
    fileName: 'favicon-32x32.png',
    rel: 'icon',
    expectedContentTypes: ['image/png'],
  },
  {
    fileName: 'favicon.ico',
    rel: 'shortcut icon',
    expectedContentTypes: [
      'image/x-icon',
      'image/vnd.microsoft.icon',
      'image/ico',
    ],
  },
];

function readAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
      ([, name, doubleQuoted, singleQuoted]) => [
        name.toLowerCase(),
        doubleQuoted ?? singleQuoted,
      ],
    ),
  );
}

export function extractPublishedFaviconUrls(html, pageUrl) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) =>
    readAttributes(tag),
  );

  return FAVICONS.map(({ fileName, rel }) => {
    const link = links.find((attributes) => {
      if (attributes.rel?.toLowerCase() !== rel) return false;
      if (!attributes.href) return false;
      return new URL(attributes.href, pageUrl).pathname.endsWith(`/${fileName}`);
    });

    if (!link) {
      throw new Error(
        `Published HTML is missing the ${rel} link for ${fileName}.`,
      );
    }

    return {
      fileName,
      url: new URL(link.href, pageUrl),
    };
  });
}

export function createFaviconCacheIdentity(favicon) {
  return createHash('sha256').update(favicon).digest('hex').slice(0, 12);
}

function createContentHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function readExpectedRelease() {
  const assets = await Promise.all(
    FAVICONS.map(async ({ fileName }) => {
      const content = await readFile(
        new URL(`../public/${fileName}`, import.meta.url),
      );
      return [fileName, content];
    }),
  );
  const contents = Object.fromEntries(assets);

  return {
    cacheIdentity: createFaviconCacheIdentity(contents['favicon.svg']),
    contentHashes: Object.fromEntries(
      assets.map(([fileName, content]) => [
        fileName,
        createContentHash(content),
      ]),
    ),
  };
}

export async function checkPublishedFavicons(
  publishedUrl,
  fetchImpl = fetch,
  expectedRelease,
) {
  let pageUrl;
  try {
    pageUrl = new URL(publishedUrl);
  } catch {
    throw new Error(
      `Published URL must be an absolute HTTP(S) URL, received "${publishedUrl}".`,
    );
  }

  if (!['http:', 'https:'].includes(pageUrl.protocol)) {
    throw new Error(
      `Published URL must use HTTP(S), received "${pageUrl.protocol}".`,
    );
  }

  const htmlResponse = await fetchImpl(pageUrl, {
    headers: { accept: 'text/html' },
    redirect: 'follow',
  });
  if (!htmlResponse.ok) {
    throw new Error(
      `Published HTML request failed: ${htmlResponse.status} ${htmlResponse.statusText}.`,
    );
  }

  const resolvedPageUrl = htmlResponse.url || pageUrl.href;
  const faviconUrls = extractPublishedFaviconUrls(
    await htmlResponse.text(),
    resolvedPageUrl,
  );
  const cacheIdentities = faviconUrls.map(({ fileName, url }) => {
    const identity = url.searchParams.get('v');
    if (!identity) {
      throw new Error(
        `Published ${fileName} URL is missing the favicon cache identity (?v=...).`,
      );
    }
    return identity;
  });
  const publishedIdentity = cacheIdentities[0];

  if (cacheIdentities.some((identity) => identity !== publishedIdentity)) {
    throw new Error(
      `Published favicon URLs do not share one cache identity: ${faviconUrls
        .map(({ fileName }, index) => `${fileName}=${cacheIdentities[index]}`)
        .join(', ')}.`,
    );
  }

  const expected = expectedRelease || (await readExpectedRelease());
  const expectedIdentity = expected.cacheIdentity;
  if (publishedIdentity !== expectedIdentity) {
    throw new Error(
      `Published favicon cache identity "${publishedIdentity}" is stale; the current build expects "${expectedIdentity}".`,
    );
  }

  const results = await Promise.all(
    faviconUrls.map(async ({ fileName, url }) => {
      const favicon = FAVICONS.find((entry) => entry.fileName === fileName);
      const response = await fetchImpl(url, {
        headers: { accept: favicon.expectedContentTypes.join(', ') },
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(
          `Published ${fileName} request failed: ${response.status} ${response.statusText}.`,
        );
      }

      const finalUrl = new URL(response.url || url.href);
      const finalIdentity = finalUrl.searchParams.get('v');
      if (finalIdentity !== expectedIdentity) {
        throw new Error(
          `Published ${fileName} request changed cache identity from "${expectedIdentity}" to "${finalIdentity ?? '(missing)'}" (${url.href} -> ${finalUrl.href}).`,
        );
      }

      const contentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (!favicon.expectedContentTypes.includes(contentType)) {
        throw new Error(
          `Published ${fileName} returned content-type "${contentType ?? '(missing)'}"; expected ${favicon.expectedContentTypes.join(' or ')}.`,
        );
      }

      const publishedContentHash = createContentHash(
        Buffer.from(await response.arrayBuffer()),
      );
      const expectedContentHash = expected.contentHashes[fileName];
      if (publishedContentHash !== expectedContentHash) {
        throw new Error(
          `Published ${fileName} content does not match the current build asset (expected sha256 ${expectedContentHash}, received ${publishedContentHash}).`,
        );
      }

      return {
        fileName,
        url: finalUrl.href,
        contentType,
        contentHash: publishedContentHash,
        status: response.status,
      };
    }),
  );

  return { cacheIdentity: expectedIdentity, favicons: results };
}

async function main() {
  const publishedUrl =
    process.argv.slice(2).find((argument) => argument !== '--') ||
    process.env.PUBLISHED_URL;
  if (!publishedUrl) {
    throw new Error(
      'Provide the published site URL as an argument or set PUBLISHED_URL.',
    );
  }

  const result = await checkPublishedFavicons(publishedUrl);
  console.log(
    `Published favicon check passed: ${result.favicons.length} assets share cache identity ${result.cacheIdentity}.`,
  );
  for (const favicon of result.favicons) {
    console.log(
      `- ${favicon.fileName}: ${favicon.status} ${favicon.contentType} ${favicon.url}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      `Published favicon check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}