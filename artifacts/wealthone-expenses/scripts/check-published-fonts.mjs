import { pathToFileURL } from 'node:url';

const VERSIONED_FONT_PATH = '/fonts/ezyretire-v1/';
const ONE_YEAR_SECONDS = 31_536_000;
const FONT_ASSETS = [
  { fileName: 'fonts.css', expectedContentTypes: ['text/css'] },
  {
    fileName: 'dm-serif-display-400.ttf',
    expectedContentTypes: ['font/ttf', 'application/x-font-ttf'],
  },
  {
    fileName: 'inter-400.ttf',
    expectedContentTypes: ['font/ttf', 'application/x-font-ttf'],
  },
  {
    fileName: 'inter-500.ttf',
    expectedContentTypes: ['font/ttf', 'application/x-font-ttf'],
  },
  {
    fileName: 'inter-600.ttf',
    expectedContentTypes: ['font/ttf', 'application/x-font-ttf'],
  },
  {
    fileName: 'inter-700.ttf',
    expectedContentTypes: ['font/ttf', 'application/x-font-ttf'],
  },
];

function parseCacheControl(value) {
  return new Map(
    (value ?? '')
      .split(',')
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...valueParts] = directive.split('=');
        return [
          name.toLowerCase(),
          valueParts.join('=').trim().replace(/^"|"$/g, ''),
        ];
      }),
  );
}

function assertImmutableOneYearCache(fileName, cacheControl) {
  const directives = parseCacheControl(cacheControl);
  const maxAge = Number(directives.get('max-age'));
  if (
    !directives.has('public') ||
    !directives.has('immutable') ||
    !Number.isInteger(maxAge) ||
    maxAge < ONE_YEAR_SECONDS
  ) {
    throw new Error(
      `Published font asset ${VERSIONED_FONT_PATH}${fileName} returned Cache-Control "${cacheControl ?? '(missing)'}"; expected public, max-age>=${ONE_YEAR_SECONDS}, immutable.`,
    );
  }
}

export async function checkPublishedFonts(publishedUrl, fetchImpl = fetch) {
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

  const expectedOrigin = pageUrl.origin;
  const results = [];
  for (const asset of FONT_ASSETS) {
    const requestedUrl = new URL(
      `${VERSIONED_FONT_PATH}${asset.fileName}`,
      pageUrl,
    );
    const response = await fetchImpl(requestedUrl, {
      headers: { accept: asset.expectedContentTypes.join(', ') },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(
        `Published font asset ${requestedUrl.pathname} request failed: ${response.status} ${response.statusText}.`,
      );
    }

    const finalUrl = new URL(response.url || requestedUrl.href);
    if (finalUrl.origin !== expectedOrigin) {
      throw new Error(
        `Published font asset ${requestedUrl.pathname} was delivered from a different origin (${requestedUrl.href} -> ${finalUrl.href}); expected ${expectedOrigin}.`,
      );
    }

    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (!asset.expectedContentTypes.includes(contentType)) {
      throw new Error(
        `Published font asset ${requestedUrl.pathname} returned Content-Type "${contentType ?? '(missing)'}"; expected ${asset.expectedContentTypes.join(' or ')}.`,
      );
    }

    const cacheControl = response.headers.get('cache-control');
    assertImmutableOneYearCache(asset.fileName, cacheControl);
    results.push({
      path: requestedUrl.pathname,
      url: finalUrl.href,
      status: response.status,
      contentType,
      cacheControl,
    });
  }

  return { assets: results };
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

  const result = await checkPublishedFonts(publishedUrl);
  console.log(
    `Published font cache check passed: ${result.assets.length} versioned assets have an immutable one-year cache policy.`,
  );
  for (const asset of result.assets) {
    console.log(
      `- ${asset.path}: ${asset.status} ${asset.contentType} ${asset.cacheControl}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      `Published font cache check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}