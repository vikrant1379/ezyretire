import { getEnv } from "./env.js";
import * as harfbuzz from "harfbuzzjs";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import reportFontData from "../assets/noto-sans-devanagari.ttf";

type MetricFormat = "currency" | "percent" | "count" | "number";
type MonthlyReportEmailInput = {
  id: string;
  month: string;
  generatedAt?: string;
  retirementForecast?: {
    projectedRetirementMonth: string | null;
    asOfDate: string;
  };
  sections: Array<Record<string, unknown>>;
};

// Keep the raw PDF at or below 18 MiB. Base64 expands attachments by roughly
// one third, so this stays below common 25 MiB message limits with room for the
// HTML/text body and provider envelope.
export const MONTHLY_REPORT_ATTACHMENT_MAX_BYTES = 18 * 1024 * 1024;

export class MonthlyReportAttachmentTooLargeError extends Error {
  readonly code = "MONTHLY_REPORT_ATTACHMENT_TOO_LARGE";

  constructor(
    readonly attachmentBytes: number,
    readonly maximumBytes: number,
  ) {
    super(`Monthly report PDF is ${attachmentBytes} bytes; the attachment limit is ${maximumBytes} bytes`);
    this.name = "MonthlyReportAttachmentTooLargeError";
  }
}

export function assertMonthlyReportAttachmentSize(
  pdf: Buffer,
  maximumBytes = MONTHLY_REPORT_ATTACHMENT_MAX_BYTES,
): void {
  if (pdf.byteLength > maximumBytes) {
    throw new MonthlyReportAttachmentTooLargeError(pdf.byteLength, maximumBytes);
  }
}

export type PresentedMonthlyReport = {
  title: string;
  monthLabel: string;
  generatedLabel?: string;
  forecast?: { label: string; value: string; note: string };
  sections: Array<{
    title: string;
    metrics: Array<{ label: string; value: string }>;
    actions: string[];
  }>;
  highlights: Array<{ label: string; value: string }>;
  actions: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-IN", {
    month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${value}-01T12:00:00Z`));
}

function formatDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-IN", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    }).format(date)
    : value;
}

function formatMetric(value: number, format: MetricFormat) {
  if (!Number.isFinite(value)) return "Not available";
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-IN", {
        style: "currency", currency: "INR", maximumFractionDigits: 2,
      }).format(value);
    case "percent":
      return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value)}%`;
    case "count":
      return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
    default:
      return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value);
  }
}

export function presentMonthlyReport(report: MonthlyReportEmailInput): PresentedMonthlyReport {
  const sections = report.sections.map((section) => {
    const formats = isRecord(section.metricFormats) ? section.metricFormats : {};
    const metrics = isRecord(section.metrics)
      ? Object.entries(section.metrics).flatMap(([key, value]) => typeof value === "number"
        ? [{
          label: humanize(key),
          value: formatMetric(
            value,
            ["currency", "percent", "count", "number"].includes(String(formats[key]))
              ? formats[key] as MetricFormat
              : "number",
          ),
        }]
        : [])
      : [];
    const unavailable = Array.isArray(section.unavailableMetrics)
      ? section.unavailableMetrics.filter((value): value is string => typeof value === "string")
      : [];
    const actions = Array.isArray(section.actions)
      ? section.actions.filter((value): value is string => typeof value === "string")
      : [];
    return {
      title: typeof section.title === "string" ? section.title : "Monthly report section",
      metrics: [
        ...metrics,
        ...unavailable.map((key) => ({ label: humanize(key), value: "Not available" })),
      ],
      actions,
    };
  });
  const highlights = sections
    .filter((section) => section.metrics.length > 0)
    .slice(0, 3)
    .map((section) => ({
      label: `${section.title}: ${section.metrics[0].label}`,
      value: section.metrics[0].value,
    }));
  return {
    title: "ezyRetire monthly report",
    monthLabel: formatMonth(report.month),
    ...(report.generatedAt ? { generatedLabel: formatDate(report.generatedAt) } : {}),
    ...(report.retirementForecast ? {
      forecast: {
        label: "Projected retirement date",
        value: report.retirementForecast.projectedRetirementMonth
          ? formatMonth(report.retirementForecast.projectedRetirementMonth)
          : "Not yet funded before life expectancy",
        note: `Modeled as of ${formatDate(report.retirementForecast.asOfDate)}`,
      },
    } : {}),
    sections,
    highlights,
    actions: sections.flatMap((section) => section.actions).slice(0, 3),
  };
}

const reportFont = Buffer.from(reportFontData, "base64");

function tableOffset(font: Buffer, name: string) {
  const tableCount = font.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16;
    if (font.toString("ascii", offset, offset + 4) === name) {
      return font.readUInt32BE(offset + 8);
    }
  }
  throw new Error(`Monthly report PDF font is missing its ${name} table`);
}

type FontTable = { tag: string; checksum: number; offset: number; length: number };

function fontTables(font: Buffer): FontTable[] {
  return Array.from({ length: font.readUInt16BE(4) }, (_, index) => {
    const offset = 12 + index * 16;
    return {
      tag: font.toString("ascii", offset, offset + 4),
      checksum: font.readUInt32BE(offset + 4),
      offset: font.readUInt32BE(offset + 8),
      length: font.readUInt32BE(offset + 12),
    };
  });
}

function checksum(data: Buffer) {
  const padded = Buffer.alloc((data.length + 3) & ~3);
  data.copy(padded);
  let sum = 0;
  for (let offset = 0; offset < padded.length; offset += 4) {
    sum = (sum + padded.readUInt32BE(offset)) >>> 0;
  }
  return sum;
}

function subsetTrueTypeFont(font: Buffer, requestedGlyphs: Set<number>) {
  const headOffset = tableOffset(font, "head");
  const locaOffset = tableOffset(font, "loca");
  const glyfOffset = tableOffset(font, "glyf");
  const glyphCount = font.readUInt16BE(tableOffset(font, "maxp") + 4);
  const longLoca = font.readInt16BE(headOffset + 50) === 1;
  const glyphOffset = (glyph: number) => locaOffset + glyph * (longLoca ? 4 : 2);
  const glyfPosition = (glyph: number) => longLoca
    ? font.readUInt32BE(glyphOffset(glyph))
    : font.readUInt16BE(glyphOffset(glyph)) * 2;
  const used = new Set([0, ...requestedGlyphs]);

  // Composite glyphs refer to other glyph outlines that PDF viewers also need.
  const pending = [...used];
  while (pending.length) {
    const glyph = pending.pop()!;
    if (glyph < 0 || glyph >= glyphCount) continue;
    let cursor = glyfOffset + glyfPosition(glyph);
    const end = glyfOffset + glyfPosition(glyph + 1);
    if (cursor + 10 > end || font.readInt16BE(cursor) >= 0) continue;
    cursor += 10;
    let more = true;
    while (more && cursor + 4 <= end) {
      const flags = font.readUInt16BE(cursor);
      const component = font.readUInt16BE(cursor + 2);
      if (!used.has(component)) {
        used.add(component);
        pending.push(component);
      }
      cursor += 4;
      cursor += flags & 0x0001 ? 4 : 2;
      cursor += flags & 0x0008 ? 2 : flags & 0x0040 ? 4 : flags & 0x0080 ? 8 : 0;
      more = Boolean(flags & 0x0020);
    }
  }

  const locations: number[] = [];
  const outlines: Buffer[] = [];
  let outlineLength = 0;
  for (let glyph = 0; glyph < glyphCount; glyph += 1) {
    locations.push(outlineLength);
    if (!used.has(glyph)) continue;
    const start = glyfOffset + glyfPosition(glyph);
    const end = glyfOffset + glyfPosition(glyph + 1);
    const outline = font.subarray(start, end);
    outlines.push(outline);
    outlineLength += outline.length;
  }
  locations.push(outlineLength);
  const glyf = Buffer.concat(outlines);
  const loca = Buffer.alloc((glyphCount + 1) * (longLoca ? 4 : 2));
  locations.forEach((location, glyph) => longLoca
    ? loca.writeUInt32BE(location, glyph * 4)
    : loca.writeUInt16BE(location / 2, glyph * 2));

  const embeddedTableTags = new Set([
    "OS/2", "cmap", "gasp", "glyf", "head", "hhea", "hmtx", "loca", "maxp", "name", "post", "prep",
  ]);
  const tables = fontTables(font).filter(({ tag }) => embeddedTableTags.has(tag)).map((table) => {
    let data = table.tag === "glyf" ? glyf
      : table.tag === "loca" ? loca
      : Buffer.from(font.subarray(table.offset, table.offset + table.length));
    if (table.tag === "head") {
      data = Buffer.from(data);
      data.writeUInt32BE(0, 8);
    }
    return { tag: table.tag, data };
  });
  const output = Buffer.alloc(12 + tables.length * 16
    + tables.reduce((sum, table) => sum + ((table.data.length + 3) & ~3), 0));
  font.copy(output, 0, 0, 4);
  output.writeUInt16BE(tables.length, 4);
  const maximumPower = 2 ** Math.floor(Math.log2(tables.length));
  output.writeUInt16BE(maximumPower * 16, 6);
  output.writeUInt16BE(Math.log2(maximumPower), 8);
  output.writeUInt16BE(tables.length * 16 - maximumPower * 16, 10);
  let dataOffset = 12 + tables.length * 16;
  for (const [index, table] of tables.entries()) {
    const record = 12 + index * 16;
    output.write(table.tag, record, 4, "ascii");
    output.writeUInt32BE(checksum(table.data), record + 4);
    output.writeUInt32BE(dataOffset, record + 8);
    output.writeUInt32BE(table.data.length, record + 12);
    table.data.copy(output, dataOffset);
    dataOffset += (table.data.length + 3) & ~3;
  }
  const subsetHead = tableOffset(output, "head");
  output.writeUInt32BE((0xB1B0AFBA - checksum(output)) >>> 0, subsetHead + 8);
  return output;
}

function fontMetrics(font: Buffer) {
  const head = tableOffset(font, "head");
  const hhea = tableOffset(font, "hhea");
  const hmtx = tableOffset(font, "hmtx");
  const maxp = tableOffset(font, "maxp");
  const unitsPerEm = font.readUInt16BE(head + 18);
  const numberOfHMetrics = font.readUInt16BE(hhea + 34);
  const numberOfGlyphs = font.readUInt16BE(maxp + 4);
  const advanceFor = (glyph: number) => {
    const metric = Math.min(Math.max(glyph, 0), numberOfGlyphs - 1, numberOfHMetrics - 1);
    return Math.round(font.readUInt16BE(hmtx + metric * 4) * 1_000 / unitsPerEm);
  };
  const scale = (value: number) => Math.round(value * 1_000 / unitsPerEm);
  return {
    advanceFor,
    unitsPerEm,
    ascent: scale(font.readInt16BE(hhea + 4)),
    descent: scale(font.readInt16BE(hhea + 6)),
    bounds: [
      scale(font.readInt16BE(head + 36)),
      scale(font.readInt16BE(head + 38)),
      scale(font.readInt16BE(head + 40)),
      scale(font.readInt16BE(head + 42)),
    ],
  };
}

const metrics = fontMetrics(reportFont);
const reportFontBlob = new harfbuzz.Blob(reportFont);
const reportFontFace = new harfbuzz.Face(reportFontBlob);
const reportShapingFont = new harfbuzz.Font(reportFontFace);
reportShapingFont.setScale(reportFontFace.upem, reportFontFace.upem);

type ShapedGlyph = {
  id: number;
  source: string;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
};

function splitScriptRuns(value: string) {
  const runs: Array<{ script: "Deva" | "Latn"; text: string }> = [];
  let current: "Deva" | "Latn" = "Latn";
  for (const character of value) {
    const script: "Deva" | "Latn" = /\p{Script_Extensions=Devanagari}/u.test(character) ? "Deva"
      : /\p{Script=Latin}/u.test(character) ? "Latn"
      : current;
    if (runs.length === 0 || script !== current) {
      runs.push({ script, text: character });
      current = script;
    } else {
      runs.at(-1)!.text += character;
    }
  }
  return runs;
}

function shapeText(value: string) {
  const glyphs: ShapedGlyph[] = [];
  for (const run of splitScriptRuns(value)) {
    const buffer = new harfbuzz.Buffer();
    buffer.addText(run.text);
    buffer.guessSegmentProperties();
    buffer.setScript(run.script);
    harfbuzz.shape(reportShapingFont, buffer);
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    const clusters = [...new Set(infos.map(({ cluster }) => cluster))].sort((left, right) => left - right);
    const emittedClusters = new Set<number>();
    for (const [index, info] of infos.entries()) {
      const nextCluster = clusters.find((cluster) => cluster > info.cluster) ?? run.text.length;
      glyphs.push({
        id: info.codepoint,
        source: emittedClusters.has(info.cluster)
          ? "\u200b"
          : run.text.slice(info.cluster, nextCluster) || "\u200b",
        ...positions[index],
      });
      emittedClusters.add(info.cluster);
    }
  }
  return glyphs;
}

function wrap(value: string, size: number, maxWidth = 500) {
  const widthOf = (text: string) => shapeText(text)
    .reduce((sum, glyph) => sum + glyph.xAdvance, 0) * size / reportFontFace.upem;
  const words = value.split(/\s+/).flatMap((word) => {
    if (widthOf(word) <= maxWidth) return [word];
    const pieces: string[] = [];
    let piece = "";
    for (const character of word) {
      if (piece && widthOf(piece + character) > maxWidth) {
        pieces.push(piece);
        piece = character;
      } else {
        piece += character;
      }
    }
    if (piece) pieces.push(piece);
    return pieces;
  });
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = `${line} ${word}`.trim();
    if (line && widthOf(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function utf16Hex(value: string) {
  const bytes: number[] = [];
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0x3f;
    if (point <= 0xffff) {
      bytes.push(point >> 8, point & 0xff);
    } else {
      const adjusted = point - 0x10000;
      const high = 0xd800 + (adjusted >> 10);
      const low = 0xdc00 + (adjusted & 0x3ff);
      bytes.push(high >> 8, high & 0xff, low >> 8, low & 0xff);
    }
  }
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

function pdfNumber(value: number) {
  return Number(value.toFixed(3)).toString();
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function generateMonthlyReportPdf(model: PresentedMonthlyReport): Buffer {
  type StructureRole = "H1" | "H2" | "P" | "L" | "LI";
  type PdfLine = {
    text: string;
    size: number;
    bold?: boolean;
    gap?: number;
    keepWithNext?: boolean;
    structureId: number;
    structureRole: StructureRole;
    sectionId?: number;
  };
  let nextStructureId = 0;
  const structuredLine = (
    line: Omit<PdfLine, "structureId">,
  ): PdfLine => ({ ...line, structureId: nextStructureId++ });
  const requestedLines: PdfLine[] = [
    structuredLine({ text: "ezyRetire", size: 22, bold: true, gap: 4, structureRole: "P" }),
    structuredLine({
      text: `Monthly report - ${model.monthLabel}`,
      size: 17,
      bold: true,
      gap: 3,
      structureRole: "H1",
    }),
    ...(model.generatedLabel
      ? [structuredLine({
        text: `Generated ${model.generatedLabel}`,
        size: 9,
        gap: 10,
        structureRole: "P",
      })]
      : []),
  ];
  if (model.forecast) {
    requestedLines.push(
      structuredLine({ text: model.forecast.label, size: 10, bold: true, structureRole: "H2" }),
      structuredLine({ text: model.forecast.value, size: 14, bold: true, structureRole: "P" }),
      structuredLine({ text: model.forecast.note, size: 9, gap: 9, structureRole: "P" }),
    );
  }
  for (const [sectionId, section] of model.sections.entries()) {
    const firstLineIndex = requestedLines.length;
    requestedLines.push(structuredLine({
      text: section.title,
      size: 13,
      bold: true,
      gap: 3,
      keepWithNext: true,
      structureRole: "H2",
      sectionId,
    }));
    for (const metric of section.metrics) {
      requestedLines.push(structuredLine({
        text: `${metric.label}: ${metric.value}`,
        size: 10,
        structureRole: "P",
        sectionId,
      }));
    }
    for (const action of section.actions) {
      requestedLines.push(structuredLine({
        text: `- ${action}`,
        size: 9,
        structureRole: "LI",
        sectionId,
      }));
    }
    const lastLine = requestedLines.at(-1);
    if (lastLine && requestedLines.length > firstLineIndex) {
      lastLine.gap = (lastLine.gap ?? 4) + 10;
    }
  }
  const lines = requestedLines.flatMap((line) => wrap(line.text, line.size).map(
    (text, index, wrapped) => ({
      ...line,
      text,
      gap: index === wrapped.length - 1 ? line.gap : 2,
    }),
  ));
  let nextCid = 1;
  const renderedLines = lines.map((line) => ({
    ...line,
    glyphs: shapeText(line.text).map((glyph) => ({ ...glyph, cid: nextCid++ })),
  }));

  const pages: Array<Array<PdfLine & { glyphs: Array<ShapedGlyph & { cid: number }> }>> = [[]];
  let y = 760;
  for (const [index, line] of renderedLines.entries()) {
    const height = line.size + (line.gap ?? 4);
    const next = renderedLines[index + 1];
    const keptHeight = line.keepWithNext && next
      ? next.size + (next.gap ?? 4)
      : 0;
    if (y - height - keptHeight < 45) {
      pages.push([]);
      y = 760;
    }
    pages.at(-1)!.push(line);
    y -= height;
  }

  const glyphs = renderedLines.flatMap((line) => line.glyphs);
  const used = new Set(glyphs.map((glyph) => glyph.id));
  const widths = glyphs
    .map((glyph) => `${glyph.cid} [${metrics.advanceFor(glyph.id)}]`)
    .join(" ");
  const unicodeEntries = glyphs
    .map((glyph) => `<${glyph.cid.toString(16).padStart(4, "0")}> <${utf16Hex(glyph.source)}>`);
  const unicodeMap = Array.from(
    { length: Math.ceil(unicodeEntries.length / 100) },
    (_, index) => unicodeEntries.slice(index * 100, index * 100 + 100),
  ).map((entries) => `${entries.length} beginbfchar
${entries.join("\n")}
endbfchar`).join("\n");
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${unicodeMap}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  const subsetFont = subsetTrueTypeFont(reportFont, used);
  const compressedSubsetFont = deflateSync(subsetFont);
  const subsetPrefix = [...createHash("sha256")
    .update([...used].sort((left, right) => left - right).join(","))
    .digest()
    .subarray(0, 6)]
    .map((byte) => String.fromCharCode(65 + byte % 26))
    .join("");
  const subsetFontName = `${subsetPrefix}+NotoSansDevanagari`;
  const objects: string[] = [];
  const add = (body: string) => (objects.push(body), objects.length);
  const encodedSubsetFont = compressedSubsetFont.toString("hex");
  const fontFile = add(`<< /Length ${encodedSubsetFont.length + 1} /Length1 ${subsetFont.length} /Filter [/ASCIIHexDecode /FlateDecode] >>\nstream\n${encodedSubsetFont}>\nendstream`);
  const descriptor = add(`<< /Type /FontDescriptor /FontName /${subsetFontName} /Flags 4 /FontBBox [${metrics.bounds.join(" ")}] /ItalicAngle 0 /Ascent ${metrics.ascent} /Descent ${metrics.descent} /CapHeight ${metrics.ascent} /StemV 80 /FontFile2 ${fontFile} 0 R >>`);
  const cidToGid = Buffer.alloc(nextCid * 2);
  glyphs.forEach((glyph) => cidToGid.writeUInt16BE(glyph.id, glyph.cid * 2));
  const encodedCidToGid = deflateSync(cidToGid).toString("hex");
  const cidToGidRef = add(`<< /Length ${encodedCidToGid.length + 1} /Filter [/ASCIIHexDecode /FlateDecode] >>\nstream\n${encodedCidToGid}>\nendstream`);
  const descendant = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${subsetFontName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap ${cidToGidRef} 0 R >>`);
  const toUnicode = add(`<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`);
  const font = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${subsetFontName} /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${toUnicode} 0 R >>`);
  const pageRefs: number[] = [];
  const contentRefs: number[] = [];
  const markedContentByStructure = new Map<number, Array<{ mcid: number; pageIndex: number }>>();
  const pageParentEntries: number[][] = [];
  for (const [pageIndex, page] of pages.entries()) {
    let top = 760;
    let nextMcid = 0;
    pageParentEntries.push([]);
    const commands = page.map((line) => {
      const mcid = nextMcid++;
      const markedContent = markedContentByStructure.get(line.structureId) ?? [];
      markedContent.push({ mcid, pageIndex });
      markedContentByStructure.set(line.structureId, markedContent);
      let left = 50;
      const glyphCommands = line.glyphs.map((glyph) => {
        const x = left + glyph.xOffset * line.size / reportFontFace.upem;
        const y = top + glyph.yOffset * line.size / reportFontFace.upem;
        left += glyph.xAdvance * line.size / reportFontFace.upem;
        return `BT /F1 ${line.size} Tf 1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm <${glyph.cid.toString(16).padStart(4, "0")}> Tj ET`;
      }).join("\n");
      const command = `/Span << /MCID ${mcid} /ActualText <FEFF${utf16Hex(line.text)}> >> BDC\n${glyphCommands}\nEMC`;
      top -= line.size + (line.gap ?? 4);
      return command;
    }).join("\n");
    contentRefs.push(add(`<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`));
    pageRefs.push(add(""));
  }
  const pagesRef = add("");
  const structureRefs = new Map<number, number>();
  for (const line of requestedLines) {
    if (!structureRefs.has(line.structureId)) structureRefs.set(line.structureId, add(""));
  }
  const sectionRefs = model.sections.map(() => add(""));
  const documentRef = add("");
  const structureRootRef = add("");
  const parentTreeRef = add("");
  const pdfTitle = `${model.title} - ${model.monthLabel}`;
  const metadata = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(pdfTitle)}</rdf:li></rdf:Alt></dc:title>
<dc:language><rdf:Bag><rdf:li>en-IN</rdf:li><rdf:li>hi-IN</rdf:li></rdf:Bag></dc:language>
<pdfuaid:part>1</pdfuaid:part>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const metadataRef = add(`<< /Type /Metadata /Subtype /XML /Length ${Buffer.byteLength(metadata)} >>\nstream\n${metadata}\nendstream`);
  for (const line of requestedLines) {
    const ref = structureRefs.get(line.structureId)!;
    const markedContent = markedContentByStructure.get(line.structureId) ?? [];
    const kids = markedContent.map(({ mcid, pageIndex }) => {
      pageParentEntries[pageIndex][mcid] = ref;
      return `<< /Type /MCR /Pg ${pageRefs[pageIndex]} 0 R /MCID ${mcid} >>`;
    });
    const parent = line.sectionId === undefined ? documentRef : sectionRefs[line.sectionId];
    const language = /\p{Script_Extensions=Devanagari}/u.test(line.text) ? "hi-IN" : "en-IN";
    objects[ref - 1] = `<< /Type /StructElem /S /${line.structureRole} /P ${parent} 0 R /Lang (${language}) /K [${kids.join(" ")}] >>`;
  }
  model.sections.forEach((section, sectionId) => {
    const children = requestedLines
      .filter((line) => line.sectionId === sectionId)
      .map((line) => `${structureRefs.get(line.structureId)} 0 R`);
    const actionRefs = requestedLines
      .filter((line) => line.sectionId === sectionId && line.structureRole === "LI")
      .map((line) => structureRefs.get(line.structureId)!);
    if (actionRefs.length) {
      const listRef = add(`<< /Type /StructElem /S /L /P ${sectionRefs[sectionId]} 0 R /K [${actionRefs.map((ref) => `${ref} 0 R`).join(" ")}] >>`);
      const firstActionIndex = requestedLines.findIndex(
        (line) => line.sectionId === sectionId && line.structureRole === "LI",
      );
      const sectionStart = requestedLines.findIndex((line) => line.sectionId === sectionId);
      children.splice(firstActionIndex - sectionStart, actionRefs.length, `${listRef} 0 R`);
      actionRefs.forEach((ref) => {
        objects[ref - 1] = objects[ref - 1].replace(`/P ${sectionRefs[sectionId]} 0 R`, `/P ${listRef} 0 R`);
      });
    }
    objects[sectionRefs[sectionId] - 1] = `<< /Type /StructElem /S /Sect /P ${documentRef} 0 R /T <FEFF${utf16Hex(section.title)}> /K [${children.join(" ")}] >>`;
  });
  const topLevel = requestedLines
    .filter((line) => line.sectionId === undefined)
    .map((line) => `${structureRefs.get(line.structureId)} 0 R`);
  topLevel.push(...sectionRefs.map((ref) => `${ref} 0 R`));
  objects[documentRef - 1] = `<< /Type /StructElem /S /Document /P ${structureRootRef} 0 R /K [${topLevel.join(" ")}] >>`;
  objects[parentTreeRef - 1] = `<< /Nums [${pageParentEntries.map((entries, index) =>
    `${index} [${entries.map((ref) => `${ref} 0 R`).join(" ")}]`).join(" ")}] >>`;
  objects[structureRootRef - 1] = `<< /Type /StructTreeRoot /K [${documentRef} 0 R] /ParentTree ${parentTreeRef} 0 R /ParentTreeNextKey ${pages.length} >>`;
  pageRefs.forEach((ref, index) => {
    objects[ref - 1] = `<< /Type /Page /Parent ${pagesRef} 0 R /StructParents ${index} /Tabs /S /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentRefs[index]} 0 R >>`;
  });
  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;
  const info = add(`<< /Title <FEFF${utf16Hex(pdfTitle)}> >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesRef} 0 R /StructTreeRoot ${structureRootRef} 0 R /Metadata ${metadataRef} 0 R /MarkInfo << /Marked true >> /Lang (en-IN) /ViewerPreferences << /DisplayDocTitle true >> >>`);
  let output = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

export function buildMonthlyReportDelivery(report: MonthlyReportEmailInput) {
  const model = presentMonthlyReport(report);
  const filename = `ezyRetire-monthly-report-${report.month}.pdf`;
  const rows = model.sections.map((section) => `
    <tr><td colspan="2" style="padding:20px 0 8px;border-top:1px solid #d9e2dc;font-size:17px;font-weight:bold">${escapeHtml(section.title)}</td></tr>
    ${section.metrics.map((metric) => `
    <tr>
      <td style="width:62%;padding:7px 12px 7px 0;color:#68736c;vertical-align:top">${escapeHtml(metric.label)}</td>
      <td style="width:38%;padding:7px 0;text-align:right;font-weight:bold;vertical-align:top">${escapeHtml(metric.value)}</td>
    </tr>`).join("")}
    ${section.actions.length ? `<tr><td colspan="2" style="padding:8px 0"><strong>Action items</strong><ul style="margin:6px 0 0;padding-left:20px">${section.actions.map((action) => `<li style="margin:4px 0">${escapeHtml(action)}</li>`).join("")}</ul></td></tr>` : ""}`).join("");
  const summary = model.highlights.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f4;border-radius:10px;margin:18px 0;padding:12px">${model.highlights.map((item) => `<tr><td style="padding:6px;color:#68736c">${escapeHtml(item.label)}</td><td style="padding:6px;text-align:right;font-weight:bold">${escapeHtml(item.value)}</td></tr>`).join("")}</table>`
    : "";
  const forecast = model.forecast
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f4;border-radius:10px;margin:18px 0"><tr><td style="padding:16px"><div style="color:#68736c;font-size:13px">${escapeHtml(model.forecast.label)}</div><strong style="display:block;font-size:18px;margin-top:4px">${escapeHtml(model.forecast.value)}</strong><div style="color:#68736c;font-size:12px;margin-top:4px">${escapeHtml(model.forecast.note)}</div></td></tr></table>`
    : "";
  const textSections = model.sections.map((section) => [
    section.title,
    ...section.metrics.map((metric) => `${metric.label}: ${metric.value}`),
    ...section.actions.map((action) => `- ${action}`),
  ].join("\n")).join("\n\n");
  return {
    filename,
    pdf: generateMonthlyReportPdf(model),
    subject: `Your ezyRetire monthly report for ${model.monthLabel}`,
    text: `Hello,\n\nYour private ezyRetire monthly report for ${model.monthLabel} is ready. A complete PDF copy is attached.\n\n${textSections}\n\nThis report was sent only to the email address on your authenticated ezyRetire account.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:28px;color:#17211b">
      <h1 style="font-family:Georgia,serif;margin-bottom:8px">ezyRetire</h1>
      <p>Hello,</p>
      <p>Your private monthly report for <strong>${escapeHtml(model.monthLabel)}</strong> is ready. The key figures and actions are below, and the complete report is attached as a PDF.</p>
      ${summary}${forecast}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>
      <p style="color:#68736c;font-size:13px;margin-top:24px">This report was sent only to the email address on your authenticated ezyRetire account.</p>
    </div>`,
  };
}

export async function sendMonthlyReportEmail(
  email: string,
  report: MonthlyReportEmailInput,
  options: {
    apiKey?: string;
    from?: string;
    request?: typeof fetch;
    attachmentMaxBytes?: number;
  } = {},
): Promise<void> {
  const apiKey = options.apiKey ?? getEnv("RESEND_API_KEY");
  const from = options.from ?? getEnv("AUTH_EMAIL_FROM");
  if (!apiKey || !from) throw new Error("Monthly report email is not configured");
  const delivery = buildMonthlyReportDelivery(report);
  assertMonthlyReportAttachmentSize(delivery.pdf, options.attachmentMaxBytes);
  const response = await (options.request ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `monthly-report-${report.id}-${email}`,
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: delivery.subject,
      text: delivery.text,
      html: delivery.html,
      attachments: [{
        filename: delivery.filename,
        content: delivery.pdf.toString("base64"),
      }],
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Monthly report email could not be delivered");
}
