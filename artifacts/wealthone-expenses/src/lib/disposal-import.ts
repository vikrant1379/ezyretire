import * as XLSX from "xlsx";
import type { InvestmentDisposal } from "./storage";

export type DisposalRowStatus = "sale" | "purchase" | "duplicate" | "unsupported";

export type ParsedDisposalRow = {
  id: string;
  status: DisposalRowStatus;
  reason?: string;
  originalRow: Record<string, unknown>;
  parsed: Partial<InvestmentDisposal> & { tradeType?: string };
};

export type DisposalFingerprintInput = Partial<
  Pick<
    InvestmentDisposal,
    "name" | "purchaseDate" | "saleDate" | "costBasis" | "proceeds"
  >
>;

export type DisposalImportBatch = {
  id: string;
  importedAt: string;
};

export function createDisposalImportBatch(
  id = crypto.randomUUID(),
  importedAt = new Date().toISOString(),
): DisposalImportBatch {
  return { id, importedAt };
}

export function disposalImportBatchIndexes(
  disposals: Pick<InvestmentDisposal, "importBatchId">[],
  batchId: string,
): number[] {
  return disposals.flatMap((disposal, index) =>
    disposal.importBatchId === batchId ? [index] : []
  );
}

export function parseExcelDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return null;
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numericSerial = Number(trimmed);
    if (
      /^\d+(?:\.\d+)?$/.test(trimmed)
      && numericSerial >= 20_000
      && numericSerial < 100_000
    ) {
      return parseExcelDate(numericSerial);
    }
    const indianDate = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (indianDate) {
      const [, day, month, year] = indianDate;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (
        date.getUTCFullYear() === Number(year) &&
        date.getUTCMonth() === Number(month) - 1 &&
        date.getUTCDate() === Number(day)
      ) {
        return date.toISOString().slice(0, 10);
      }
    }
    const isoDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (isoDate) {
      const [, year, month, day] = isoDate;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      return date.getUTCFullYear() === Number(year)
        && date.getUTCMonth() === Number(month) - 1
        && date.getUTCDate() === Number(day)
        ? date.toISOString().slice(0, 10)
        : null;
    }
  }
  return null;
}

const ALIASES = {
  tradeType: ["trade type", "transaction type", "type", "action"],
  name: ["symbol", "security", "name", "scrip", "asset", "description"],
  purchaseDate: ["buy date", "purchase date", "date of purchase", "acquired", "date acquired"],
  saleDate: ["sell date", "sale date", "trade date", "date of sale", "disposed", "date disposed", "date"],
  costBasis: ["cost basis", "buy value", "cost", "purchase value", "cost of acquisition", "total cost", "buy amount", "purchase amount"],
  proceeds: ["net proceeds", "proceeds", "sale value", "net amount", "sell value", "value", "sell amount"],
  assetType: ["asset type", "instrument type", "category", "asset class"],
  eligibleExemption: ["exemption", "eligible exemption", "deduction", "exempt"],
};

function matchHeader(header: string, aliases: string[]): boolean {
  const normalized = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return aliases.some((alias) => normalized === alias.replace(/[^a-z0-9]+/g, " ").trim());
}

function findColumn(headers: string[], aliases: string[]): string | undefined {
  const matches = headers.filter((header) => matchHeader(header, aliases));
  if (matches.length > 0) {
    let minIndex = Infinity;
    let bestMatch = matches[0];
    matches.forEach((match) => {
      const normalized = match.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const index = aliases.findIndex(
        (alias) => alias.replace(/[^a-z0-9]+/g, " ").trim() === normalized,
      );
      if (index !== -1 && index < minIndex) {
        minIndex = index;
        bestMatch = match;
      }
    });
    return bestMatch;
  }
  return undefined;
}

function cleanupString(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (typeof val === "number") return String(val);
  return "";
}

function parseNumber(val: unknown): number {
  if (typeof val === "number") return Number.isFinite(val) ? val : Number.NaN;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return Number.NaN;
    const isParenthesized = /^\(.*\)$/.test(trimmed);
    const cleaned = trimmed
      .replace(/[₹$£€,\s]/g, "")
      .replace(/^\((.*)\)$/, "$1");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? (isParenthesized ? -parsed : parsed) : Number.NaN;
  }
  return Number.NaN;
}

export function disposalImportFingerprint(disposal: DisposalFingerprintInput) {
  return [
    (disposal.name || "").trim().toLowerCase(),
    disposal.purchaseDate || "",
    disposal.saleDate || "",
    Number(disposal.costBasis || 0).toFixed(2),
    Number(disposal.proceeds || 0).toFixed(2),
  ].join("|");
}

export function parseBrokerExport(
  fileBuffer: ArrayBuffer,
  existingDisposals: DisposalFingerprintInput[],
): ParsedDisposalRow[] {
  const workbook = XLSX.read(fileBuffer, {
    type: "array",
    cellDates: false,
    raw: true,
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
    raw: true,
  });

  if (rows.length === 0) return [];

  const headers = Object.keys(Object.assign({}, ...rows));
  const colMap = {
    tradeType: findColumn(headers, ALIASES.tradeType),
    name: findColumn(headers, ALIASES.name),
    purchaseDate: findColumn(headers, ALIASES.purchaseDate),
    saleDate: findColumn(headers, ALIASES.saleDate),
    costBasis: findColumn(headers, ALIASES.costBasis),
    proceeds: findColumn(headers, ALIASES.proceeds),
    assetType: findColumn(headers, ALIASES.assetType),
    eligibleExemption: findColumn(headers, ALIASES.eligibleExemption),
  };

  const existingFingerprintCounts = new Map<string, number>();
  const importedFingerprintCounts = new Map<string, number>();
  existingDisposals.forEach((disposal) => {
    const fingerprint = disposalImportFingerprint(disposal);
    existingFingerprintCounts.set(
      fingerprint,
      (existingFingerprintCounts.get(fingerprint) ?? 0) + 1,
    );
  });

  return rows.map((row, index) => {
    const tradeTypeRaw = colMap.tradeType ? cleanupString(row[colMap.tradeType]).toLowerCase() : "";
    const name = colMap.name ? cleanupString(row[colMap.name]) : "";

    let purchaseDateStr = colMap.purchaseDate
      ? parseExcelDate(row[colMap.purchaseDate])
      : null;
    let saleDateStr = colMap.saleDate
      ? parseExcelDate(row[colMap.saleDate])
      : null;

    const isBuy = tradeTypeRaw.includes("buy") || tradeTypeRaw.includes("purchase");
    const isSell = tradeTypeRaw.includes("sell") || tradeTypeRaw.includes("sale");

    if (colMap.saleDate && !colMap.purchaseDate) {
      if (isBuy) {
        purchaseDateStr = saleDateStr;
        saleDateStr = null;
      }
    }

    const costBasis = colMap.costBasis ? parseNumber(row[colMap.costBasis]) : NaN;
    const proceeds = colMap.proceeds ? parseNumber(row[colMap.proceeds]) : NaN;
    const assetType = colMap.assetType ? cleanupString(row[colMap.assetType]) : undefined;
    const eligibleExemption = colMap.eligibleExemption ? parseNumber(row[colMap.eligibleExemption]) : 0;

    const parsed: Partial<InvestmentDisposal> & { tradeType?: string } = {
      name,
      purchaseDate: purchaseDateStr || undefined,
      saleDate: saleDateStr || undefined,
      costBasis: Number.isFinite(costBasis) ? costBasis : undefined,
      proceeds: Number.isFinite(proceeds) ? proceeds : undefined,
      assetType: assetType || undefined,
      eligibleExemption: Number.isFinite(eligibleExemption) ? eligibleExemption : undefined,
      tradeType: tradeTypeRaw || undefined,
    };

    let status: DisposalRowStatus = "unsupported";
    let reason: string | undefined;

    if (isBuy) {
      status = "purchase";
      reason = "Purchase mapped for review; only sales will be saved";
    } else if (isSell || (purchaseDateStr && saleDateStr)) {
      status = "sale";
      if (!name) {
        status = "unsupported";
        reason = "Missing name or security";
      } else if (!purchaseDateStr) {
        status = "unsupported";
        reason = "Missing or invalid purchase date";
      } else if (!saleDateStr) {
        status = "unsupported";
        reason = "Missing or invalid sale date";
      } else if (saleDateStr < purchaseDateStr) {
        status = "unsupported";
        reason = "Sale date is before purchase date";
      } else if (!Number.isFinite(costBasis)) {
        status = "unsupported";
        reason = "Missing or invalid cost basis";
      } else if (costBasis < 0) {
        status = "unsupported";
        reason = "Cost basis cannot be negative";
      } else if (!Number.isFinite(proceeds)) {
        status = "unsupported";
        reason = "Missing or invalid proceeds";
      } else if (proceeds < 0) {
        status = "unsupported";
        reason = "Proceeds cannot be negative";
      }
    } else {
      status = "unsupported";
      reason = "Not recognized as a sale or purchase";
    }

    if (status === "sale") {
      const fingerprint = disposalImportFingerprint(parsed);
      const occurrence = (importedFingerprintCounts.get(fingerprint) ?? 0) + 1;
      importedFingerprintCounts.set(fingerprint, occurrence);
      if (occurrence <= (existingFingerprintCounts.get(fingerprint) ?? 0)) {
        status = "duplicate";
        reason = "Already recorded";
      }
    }

    return {
      id: `row-${index}`,
      status,
      reason,
      originalRow: row,
      parsed,
    };
  });
}
