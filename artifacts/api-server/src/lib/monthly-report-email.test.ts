import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";
import {
  assertMonthlyReportAttachmentSize,
  buildMonthlyReportDelivery,
  MONTHLY_REPORT_ATTACHMENT_MAX_BYTES,
  MonthlyReportAttachmentTooLargeError,
  presentMonthlyReport,
  sendMonthlyReportEmail,
} from "./monthly-report-email.js";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

const report = {
    id: "monthly-report-2025-03",
    month: "2025-03",
    generatedAt: "2025-04-01T00:00:00.000Z",
    retirementForecast: {
      projectedRetirementMonth: null,
      asOfDate: "2025-03-31",
    },
    sections: [{
      id: "savings-amount-rate",
      title: "Savings & <progress>",
      metrics: { amount: 123456.5, rate: 20.25, categoryCount: 3 },
      metricFormats: { amount: "currency", rate: "percent", categoryCount: "count" },
      unavailableMetrics: ["priorMonthBalance"],
      actions: ["Review <subscriptions> & recurring costs."],
    }],
};

GlobalWorkerOptions.workerSrc = import.meta.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

test("monthly report delivery keeps labels readable and creates a complete PDF", () => {
  const model = presentMonthlyReport(report);
  assert.equal(model.monthLabel, "March 2025");
  assert.deepEqual(model.sections[0].metrics.map(({ label, value }) => [label, value]), [
    ["Amount", "₹1,23,456.50"],
    ["Rate", "20.3%"],
    ["Category Count", "3"],
    ["Prior Month Balance", "Not available"],
  ]);
  assert.equal(model.forecast?.note, "Modeled as of 31 March 2025");

  const delivery = buildMonthlyReportDelivery(report);
  assert.equal(delivery.filename, "ezyRetire-monthly-report-2025-03.pdf");
  assert.match(delivery.text, /complete PDF copy is attached/);
  assert.match(delivery.text, /Review <subscriptions> & recurring costs/);
  assert.match(delivery.html, /<table role="presentation"/);
  assert.doesNotMatch(delivery.html, /display:flex/);
  assert.match(delivery.html, /Savings &amp; &lt;progress&gt;/);
  assert.match(delivery.html, /Review &lt;subscriptions&gt; &amp; recurring costs/);
  assert.equal(delivery.pdf.subarray(0, 8).toString(), "%PDF-1.7");
  assert.match(delivery.pdf.toString("latin1"), /\/Metadata \d+ 0 R/);
  assert.match(delivery.pdf.toString("latin1"), /<pdfuaid:part>1<\/pdfuaid:part>/);
  assert.ok(delivery.pdf.length > 1_000);
  assert.ok(delivery.pdf.length < 300_000, `expected a subset font PDF, got ${delivery.pdf.length} bytes`);
});

test("monthly report email sends the named PDF attachment with the shared summary", async () => {
  let requestBody: Record<string, unknown> | undefined;
  let idempotencyKey: string | null = null;
  await sendMonthlyReportEmail("person@example.test", report, {
    apiKey: "test-key",
    from: "ezyRetire <reports@example.test>",
    request: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      idempotencyKey = new Headers(init?.headers).get("idempotency-key");
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(idempotencyKey, "monthly-report-monthly-report-2025-03-person@example.test");
  const [attachment] = requestBody?.attachments as Array<Record<string, unknown>>;
  assert.equal(attachment.filename, "ezyRetire-monthly-report-2025-03.pdf");
  assert.match(String(attachment.content), /^[A-Za-z0-9+/]+=*$/);
  assert.equal(
    Buffer.from(String(attachment.content), "base64").subarray(0, 8).toString(),
    "%PDF-1.7",
  );
  assert.match(String(requestBody?.text), /complete PDF copy is attached/);
  assert.match(String(requestBody?.html), /Amount/);
});

test("monthly report attachment budget accepts the boundary and rejects the next byte", () => {
  assert.doesNotThrow(() => assertMonthlyReportAttachmentSize(
    Buffer.alloc(MONTHLY_REPORT_ATTACHMENT_MAX_BYTES),
  ));
  assert.throws(
    () => assertMonthlyReportAttachmentSize(
      Buffer.alloc(MONTHLY_REPORT_ATTACHMENT_MAX_BYTES + 1),
    ),
    (error) => {
      assert.ok(error instanceof MonthlyReportAttachmentTooLargeError);
      assert.equal(error.code, "MONTHLY_REPORT_ATTACHMENT_TOO_LARGE");
      assert.equal(error.attachmentBytes, MONTHLY_REPORT_ATTACHMENT_MAX_BYTES + 1);
      assert.equal(error.maximumBytes, MONTHLY_REPORT_ATTACHMENT_MAX_BYTES);
      return true;
    },
  );
});

test("oversized monthly report fails before the provider request", async () => {
  let providerRequests = 0;
  await assert.rejects(
    sendMonthlyReportEmail("person@example.test", report, {
      apiKey: "test-key",
      from: "ezyRetire <reports@example.test>",
      attachmentMaxBytes: 1,
      request: async () => {
        providerRequests += 1;
        return new Response(null, { status: 200 });
      },
    }),
    (error) => error instanceof MonthlyReportAttachmentTooLargeError
      && error.code === "MONTHLY_REPORT_ATTACHMENT_TOO_LARGE",
  );
  assert.equal(providerRequests, 0);
});

function decodeUtf16Hex(value: string) {
  const bytes = Buffer.from(value, "hex");
  return Array.from(
    { length: bytes.length / 2 },
    (_, index) => String.fromCharCode(bytes.readUInt16BE(index * 2)),
  ).join("");
}

function inspectEmbeddedFont(pdf: string) {
  const match = pdf.match(
    /\/Length \d+ \/Length1 (\d+) \/Filter \[\/ASCIIHexDecode \/FlateDecode\] >>\nstream\n([0-9a-f]+)>\nendstream/,
  );
  assert.ok(match, "expected a compressed embedded TrueType font");
  const font = inflateSync(Buffer.from(match[2], "hex"));
  assert.equal(font.length, Number(match[1]));
  const tableRecord = (tag: string) => {
    for (let index = 0; index < font.readUInt16BE(4); index += 1) {
      const record = 12 + index * 16;
      if (font.toString("ascii", record, record + 4) === tag) {
        return {
          offset: font.readUInt32BE(record + 8),
          length: font.readUInt32BE(record + 12),
        };
      }
    }
    throw new Error(`Missing ${tag} table`);
  };
  const head = tableRecord("head").offset;
  const loca = tableRecord("loca").offset;
  const glyf = tableRecord("glyf");
  const glyphCount = font.readUInt16BE(tableRecord("maxp").offset + 4);
  const longLoca = font.readInt16BE(head + 50) === 1;
  const location = (glyph: number) => longLoca
    ? font.readUInt32BE(loca + glyph * 4)
    : font.readUInt16BE(loca + glyph * 2) * 2;
  const outlinedGlyphs = Array.from({ length: glyphCount }, (_, glyph) => glyph)
    .filter((glyph) => location(glyph) !== location(glyph + 1));
  const componentsOf = (glyph: number) => {
    let cursor = glyf.offset + location(glyph);
    const end = glyf.offset + location(glyph + 1);
    if (cursor + 10 > end || font.readInt16BE(cursor) >= 0) return [];
    cursor += 10;
    const components: number[] = [];
    let more = true;
    while (more && cursor + 4 <= end) {
      const flags = font.readUInt16BE(cursor);
      components.push(font.readUInt16BE(cursor + 2));
      cursor += 4;
      cursor += flags & 0x0001 ? 4 : 2;
      cursor += flags & 0x0008 ? 2 : flags & 0x0040 ? 4 : flags & 0x0080 ? 8 : 0;
      more = Boolean(flags & 0x0020);
    }
    return components;
  };
  const locations = Array.from({ length: glyphCount + 1 }, (_, glyph) => location(glyph));
  assert.ok(locations.every((value, index) => index === 0 || value >= locations[index - 1]));
  assert.equal(locations.at(-1), glyf.length);
  let fontChecksum = 0;
  for (let offset = 0; offset < font.length; offset += 4) {
    fontChecksum = (fontChecksum + font.readUInt32BE(offset)) >>> 0;
  }
  assert.equal(fontChecksum, 0xB1B0AFBA);
  return { font, outlinedGlyphs, componentsOf };
}

test("monthly report PDF shapes Unicode and wraps oversized content inside the page", async () => {
  const longToken = "W".repeat(160);
  const complexScript = "चिकित्सा";
  const pdf = buildMonthlyReportDelivery({
    ...report,
    sections: [{
      title: complexScript,
      metrics: { amount: 1 },
      metricFormats: { amount: "currency" },
      actions: [`अगले महीने Café खर्चों की समीक्षा करें। ${longToken}`, longToken],
    }],
  }).pdf;

  const warnings: string[] = [];
  const pdfSource = pdf.toString("latin1");

  const actualTextBlocks = [...pdfSource.matchAll(/\/ActualText <FEFF([0-9A-F]*)> >> BDC\n([\s\S]*?)\nEMC/g)]
    .map((match) => ({ text: decodeUtf16Hex(match[1]), commands: match[2] }));
  assert.equal(
    actualTextBlocks.flatMap(({ text }) => text.match(/W+/g) ?? []).join(""),
    longToken.repeat(2),
  );
  assert.ok(actualTextBlocks.filter(({ text }) => text.includes("W")).length > 2);
  assert.ok(actualTextBlocks.every(({ text }) => !text.includes(longToken)));
  const complexBlock = actualTextBlocks.find(({ text }) => text === complexScript);
  assert.ok(complexBlock);
  assert.equal(complexBlock.commands.match(/ Tj ET/g)?.length, 7);
  assert.ok(7 < [...complexScript].length);
  assert.ok(pdf.length < 400_000, `expected a subset multilingual PDF, got ${pdf.length} bytes`);

  const renderedGlyphs = new Set([...pdfSource.matchAll(/<([0-9a-f]{4})> Tj/g)]
    .map((match) => Number.parseInt(match[1], 16)));
  const unicodeMap = pdfSource.match(/endcodespacerange\n([\s\S]*?)\nendcmap/)?.[1] ?? "";
  const extractionGlyphs = new Set([...unicodeMap.matchAll(/<([0-9a-f]{4})> <[0-9A-F]+>/g)]
    .map((match) => Number.parseInt(match[1], 16)));
  assert.deepEqual(extractionGlyphs, renderedGlyphs);
  assert.match(pdfSource, /\/BaseFont \/[A-Z]{6}\+NotoSansDevanagari/);
  const { font, outlinedGlyphs, componentsOf } = inspectEmbeddedFont(pdfSource);

  assert.ok(font.length < 150_000, `expected subset font data, got ${font.length} bytes`);
  assert.ok(outlinedGlyphs.length < 100, `expected only requested outlines, got ${outlinedGlyphs.length}`);
  const cidToGidRef = pdfSource.match(/\/CIDToGIDMap (\d+) 0 R/)?.[1];
  assert.ok(cidToGidRef, "expected an embedded CID-to-glyph map");
  const cidToGidMatch = pdfSource.match(new RegExp(
    `${cidToGidRef} 0 obj\\n<< \\/Length \\d+ \\/Filter \\[\\/ASCIIHexDecode \\/FlateDecode\\] >>\\nstream\\n([0-9a-f]+)>`,
  ));
  assert.ok(cidToGidMatch, "expected a compressed CID-to-glyph map");
  const cidToGid = inflateSync(Buffer.from(cidToGidMatch[1], "hex"));
  const renderedOutlineGlyphs = [...renderedGlyphs]
    .map((cid) => cidToGid.readUInt16BE(cid * 2));
  const componentGlyphs = renderedOutlineGlyphs.flatMap(componentsOf);
  assert.ok(componentGlyphs.length > 0, "expected the fixture to exercise composite glyphs");
  assert.ok(componentGlyphs.every((glyph) => outlinedGlyphs.includes(glyph)));

  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    const loadingTask = getDocument({
      data: new Uint8Array(pdf),
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 1,
    });
    const document = await loadingTask.promise;
    const page = await document.getPage(1);
    const text = (await page.getTextContent()).items
      .flatMap((item) => "str" in item ? [item.str] : [])
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    const compact = (value: string) => value.normalize("NFC").replace(/[\s\u200b]+/gu, "");
    assert.match(compact(text), /अगलेमहीनेCaféखर्चोंकीसमीक्षाकरें।/u);
    assert.ok(compact(text).includes(longToken));
    assert.equal(warnings.length, 0, `PDF.js emitted warnings: ${warnings.join("\n")}`);
    await loadingTask.destroy();
  } finally {
    console.warn = originalWarn;
  }
});

type StructureNode = {
  role?: string;
  children?: Array<StructureNode | { type: string; id: string }>;
};

function structureRoles(node: StructureNode): string[] {
  return [
    ...(node.role ? [node.role] : []),
    ...(node.children ?? []).flatMap((child) => "role" in child ? structureRoles(child) : []),
  ];
}

function structureContentIds(node: StructureNode): string[] {
  return (node.children ?? []).flatMap((child) =>
    "type" in child ? child.type === "content" ? [child.id] : [] : structureContentIds(child));
}

test("monthly report PDF exposes semantic reading order to an independent consumer", async () => {
  const sectionTitle = "निवेश योजना";
  const metricText = "Monthly Savings: ₹25,000.00";
  const actionText = "Review खर्चों की समीक्षा करें।";
  const pdf = buildMonthlyReportDelivery({
    id: "accessible-report",
    month: "2025-03",
    generatedAt: "2025-04-01T00:00:00.000Z",
    sections: [{
      title: sectionTitle,
      metrics: { monthlySavings: 25_000 },
      metricFormats: { monthlySavings: "currency" },
      actions: [actionText],
    }],
  }).pdf;
  const loadingTask = getDocument({
    data: new Uint8Array(pdf),
    disableFontFace: true,
    useSystemFonts: false,
  });
  const document = await loadingTask.promise;

  try {
    const metadata = await document.getMetadata();
    const info = metadata.info as Record<string, unknown>;
    assert.equal(info.Title, "ezyRetire monthly report - March 2025");
    assert.equal(info.Language, "en-IN");

    const page = await document.getPage(1);
    const structure = await page.getStructTree() as StructureNode | null;
    assert.ok(structure, "an accessibility-aware PDF consumer should find a structure tree");
    assert.deepEqual(structureRoles(structure), [
      "Root",
      "Document",
      "P",
      "H1",
      "P",
      "Sect",
      "H2",
      "P",
      "L",
      "LI",
    ]);

    const content = await page.getTextContent({ includeMarkedContent: true });
    const textByContentId = new Map<string, string>();
    let activeContentId: string | undefined;
    for (const item of content.items) {
      if ("type" in item) {
        if (item.type === "beginMarkedContentProps") {
          activeContentId = item.id;
          textByContentId.set(activeContentId, "");
        } else if (item.type === "endMarkedContent") {
          activeContentId = undefined;
        }
      } else if (activeContentId) {
        textByContentId.set(activeContentId, `${textByContentId.get(activeContentId)}${item.str}`);
      }
    }
    const readingOrder = structureContentIds(structure)
      .map((id) => textByContentId.get(id) ?? "")
      .join(" ")
      .normalize("NFC");
    const compact = (value: string) => value.replace(/[\s\u200b]+/gu, "");
    const orderedContent = [
      "ezyRetire",
      "Monthly report - March 2025",
      "Generated 1 April 2025",
      sectionTitle,
      metricText,
      `- ${actionText}`,
    ].map((value) => compact(value));
    let previousPosition = -1;
    for (const expected of orderedContent) {
      const position = compact(readingOrder).indexOf(expected);
      assert.ok(position > previousPosition, `${expected} should follow the preceding report content`);
      previousPosition = position;
    }
  } finally {
    await loadingTask.destroy();
  }
});

type RenderedPage = {
  data: Uint8ClampedArray;
  height: number;
  width: number;
};

function inkBounds(image: RenderedPage) {
  let left = image.width;
  let right = -1;
  let top = image.height;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = (y * image.width + x) * 4;
      if (image.data[pixel] === 255 && image.data[pixel + 1] === 255
        && image.data[pixel + 2] === 255 && image.data[pixel + 3] === 255) {
        continue;
      }
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  assert.notEqual(right, -1, "rendered report page should contain visible ink");
  return { bottom, left, right, top };
}

test("monthly report PDF rendered output stays shaped, wrapped, and inside page margins", async () => {
  const longValue = "ACCOUNTREFERENCE".repeat(18);
  const sections = Array.from({ length: 12 }, (_, sectionIndex) => ({
    title: sectionIndex === 4
      ? "निवेश और चिकित्सा योजना"
      : `Planning section ${sectionIndex + 1}`,
    metrics: Object.fromEntries(Array.from(
      { length: 5 },
      (_, metricIndex) => [`balance${metricIndex + 1}`, 1234567.89 + sectionIndex * 100 + metricIndex],
    )),
    metricFormats: Object.fromEntries(Array.from(
      { length: 5 },
      (_, metricIndex) => [`balance${metricIndex + 1}`, "currency"],
    )),
    actions: [
      sectionIndex === 4
        ? `अगले महीने खर्चों की समीक्षा करें और लक्ष्य की प्रगति जाँचें। ${longValue}`
        : `Review the monthly plan before confirming changes. ${longValue}`,
    ],
  }));
  const pdf = buildMonthlyReportDelivery({
    ...report,
    id: "rendered-layout-fixture",
    sections,
  }).pdf;

  const loadingTask = getDocument({
    data: new Uint8Array(pdf),
    disableFontFace: true,
    useSystemFonts: false,
  });
  const document = await loadingTask.promise;
  try {
    const images: RenderedPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      images.push({
        data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        height: canvas.height,
        width: canvas.width,
      });
      page.cleanup();
    }

    assert.ok(images.length >= 3, "fixture should exercise multiple PDF page boundaries");
    const renderedHashes = images.map((image) => createHash("sha256")
      .update(image.data)
      .digest("hex"));
    assert.deepEqual(renderedHashes, [
      "10231694cceb5df129193e9fb890a4c7e19b7ee686d5f95b034473596a703582",
      "9cb049e6b9eff23f38f8a6c234d99edb9df01e4a56196d50e8683f1c19ddd50c",
      "c37d481478cac451570309cc4d41454f662c5d30c8009ceb3ede895048ec4c52",
    ], "rendered report pixels changed; inspect wrapping, clipping, page breaks, and Devanagari shaping");

    for (const image of images) {
      assert.deepEqual([image.width, image.height], [1224, 1584]);
      const bounds = inkBounds(image);
      const horizontalMargin = 90;
      const topMargin = 24;
      const bottomMargin = 80;
      assert.ok(bounds.left >= horizontalMargin, `content crossed the left margin at ${bounds.left}px`);
      assert.ok(bounds.right < image.width - horizontalMargin, `content crossed the right margin at ${bounds.right}px`);
      assert.ok(bounds.top >= topMargin, `content crossed the top margin at ${bounds.top}px`);
      assert.ok(bounds.bottom < image.height - bottomMargin, `content crossed the bottom margin at ${bounds.bottom}px`);
    }
  } finally {
    await loadingTask.destroy();
  }
});
