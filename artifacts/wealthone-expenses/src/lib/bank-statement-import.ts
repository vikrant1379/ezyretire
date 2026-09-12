import type { Expense } from "./storage.ts";

export const BANK_STATEMENT_LIMITS = {
  csvBytes: 5 * 1024 * 1024,
  pdfBytes: 10 * 1024 * 1024,
  rows: 5_000,
  merchant: 160,
  category: 80,
  paymentMethod: 80,
  note: 2_000,
} as const;

export type SupportedBank =
  | "SBI"
  | "HDFC"
  | "ICICI"
  | "Axis"
  | "Kotak"
  | "PNB"
  | "BOB"
  | "IndusInd";

export type BankStatementRow = {
  id: string;
  date: string;
  amount: number;
  merchant: string;
  description: string;
  category: string;
  confidence: number;
  duplicate: boolean;
  selfTransfer: boolean;
  selected: boolean;
  provenance: { fileType: "csv" | "pdf"; row: number };
  importId: string;
  bank: SupportedBank;
  parserVersion: string;
  sourceRowId: string;
};

export type BankStatementReview = {
  bank: SupportedBank;
  version: string;
  importId: string;
  confidence: number;
  rows: BankStatementRow[];
  issues: BankStatementReviewIssue[];
};

export type BankStatementReviewIssue = {
  row: number;
  field: "date" | "amount" | "description" | "direction";
  value: string;
  message: string;
};

const bankMatchers: Array<[SupportedBank, RegExp]> = [
  ["SBI", /\b(?:state bank of india|sbi)\b/i],
  ["HDFC", /\bhdfc(?: bank)?\b/i],
  ["ICICI", /\bicici(?: bank)?\b/i],
  ["Axis", /\baxis bank\b/i],
  ["Kotak", /\bkotak(?: mahindra)?(?: bank)?\b/i],
  ["PNB", /\b(?:punjab national bank|pnb)\b/i],
  ["BOB", /\b(?:bank of baroda|bob)\b/i],
  ["IndusInd", /\bindusind(?: bank)?\b/i],
];
type DirectionStrategy =
  | { kind: "debit-column"; debitHeaders: readonly string[] }
  | {
    kind: "amount-indicator";
    amountHeaders: readonly string[];
    indicatorHeaders: readonly string[];
    debitIndicators: readonly string[];
  };

export type BankStatementAdapter = {
  bank: SupportedBank;
  version: string;
  dateHeaders: readonly string[];
  descriptionHeaders: readonly string[];
  directions: readonly DirectionStrategy[];
};

const debitAndIndicator = (
  debitHeaders: readonly string[],
  amountHeaders: readonly string[] = ["amount", "transaction amount"],
  indicatorHeaders: readonly string[] = ["dr/cr", "debit/credit", "type"],
): readonly DirectionStrategy[] => [
  { kind: "debit-column", debitHeaders },
  { kind: "amount-indicator", amountHeaders, indicatorHeaders, debitIndicators: ["dr", "debit", "d"] },
];

// These are deliberately separate contracts rather than a shared fuzzy column
// resolver. A detected bank is parsed only against its documented aliases.
export const bankStatementAdapters: Record<SupportedBank, BankStatementAdapter> = {
  SBI: {
    bank: "SBI", version: "sbi-v1",
    dateHeaders: ["transaction date", "txn date", "value date"],
    descriptionHeaders: ["narration", "description", "transaction details"],
    directions: debitAndIndicator(["debit", "withdrawal", "withdrawal amount"]),
  },
  HDFC: {
    bank: "HDFC", version: "hdfc-v1",
    dateHeaders: ["date", "txn date", "transaction date"],
    descriptionHeaders: ["narration", "description"],
    directions: debitAndIndicator(["debit", "withdrawal amt.", "withdrawal amount"]),
  },
  ICICI: {
    bank: "ICICI", version: "icici-v1",
    dateHeaders: ["transaction date", "value date"],
    descriptionHeaders: ["transaction remarks", "description", "narration"],
    directions: debitAndIndicator(["withdrawal amount", "debit"]),
  },
  Axis: {
    bank: "Axis", version: "axis-v1",
    dateHeaders: ["tran date", "transaction date"],
    descriptionHeaders: ["particulars", "description", "narration"],
    directions: debitAndIndicator(["debit", "withdrawal amount"], ["amount"], ["dr/cr", "transaction type"]),
  },
  Kotak: {
    bank: "Kotak", version: "kotak-v1",
    dateHeaders: ["transaction date", "date"],
    descriptionHeaders: ["description", "narration", "particulars"],
    directions: debitAndIndicator(["debit", "withdrawal"]),
  },
  PNB: {
    bank: "PNB", version: "pnb-v1",
    dateHeaders: ["value date", "transaction date"],
    descriptionHeaders: ["particulars", "narration", "description"],
    directions: debitAndIndicator(["withdrawal", "debit"]),
  },
  BOB: {
    bank: "BOB", version: "bob-v1",
    dateHeaders: ["date", "transaction date"],
    descriptionHeaders: ["narration", "description", "particulars"],
    directions: debitAndIndicator(["debit", "withdrawal"]),
  },
  IndusInd: {
    bank: "IndusInd", version: "indusind-v1",
    dateHeaders: ["transaction date", "date"],
    descriptionHeaders: ["description", "narration", "transaction details"],
    directions: debitAndIndicator(["debit", "withdrawal amount"], ["transaction amount", "amount"], ["debit/credit", "dr/cr"]),
  },
};

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const amount = (value: string) => {
  const parsed = Number(value.replace(/[₹,\s"]/g, "").replace(/[()]/g, "").replace(/(?:dr|cr)$/i, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(clean(field)); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(clean(field)); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("Malformed CSV: unterminated quoted field.");
  row.push(clean(field));
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function detectBank(text: string): SupportedBank {
  const sample = text.slice(0, 30_000);
  const match = bankMatchers
    .map(([bank, pattern], order) => {
      const evidence = pattern.exec(sample);
      return evidence ? { bank, index: evidence.index, order } : null;
    })
    .filter((candidate): candidate is { bank: SupportedBank; index: number; order: number } => candidate !== null)
    .sort((left, right) => left.index - right.index || left.order - right.order)[0];
  if (!match) {
    throw new Error("Unsupported statement. Use a statement exported by SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB, or IndusInd.");
  }
  return match.bank;
}

function categoryFor(description: string): string {
  const value = description.toLowerCase();
  if (/(swiggy|zomato|restaurant|cafe|food)/.test(value)) return "Food & Dining";
  if (/(uber|ola|metro|fuel|petrol|irctc|travel)/.test(value)) return "Transportation";
  if (/(amazon|flipkart|myntra|shopping)/.test(value)) return "Shopping";
  if (/(electric|water|gas|broadband|mobile|recharge|utility)/.test(value)) return "Bills & Utilities";
  if (/(hospital|pharmacy|medical|clinic)/.test(value)) return "Healthcare";
  if (/(rent|housing)/.test(value)) return "Housing";
  if (/(insurance|premium)/.test(value)) return "Insurance";
  if (/(school|college|course|education)/.test(value)) return "Education";
  return "Miscellaneous";
}

export function isLikelySelfTransfer(description: string): boolean {
  return /(?:self|own\s+a\/?c|to\s+my\s+account|between\s+accounts|sweep|auto\s*transfer)/i.test(description);
}

function comparableFingerprint(row: Pick<BankStatementRow, "date" | "amount" | "merchant">) {
  return `${row.date.slice(0, 10)}|${row.amount.toFixed(2)}|${clean(row.merchant).toLowerCase()}`;
}

function markFlags(rows: BankStatementRow[], existing: Expense[]): BankStatementRow[] {
  const existingKeys = new Set(existing.map((item) => comparableFingerprint({
    date: item.date, amount: item.amount, merchant: item.merchant,
  })));
  const seen = new Set<string>();
  return rows.map((row) => {
    const key = comparableFingerprint(row);
    const duplicate = existingKeys.has(key) || seen.has(key);
    seen.add(key);
    const selfTransfer = isLikelySelfTransfer(row.description);
    // Duplicate matches are review warnings, not authoritative suppression:
    // identical same-day purchases are legitimate. Self transfers remain
    // opt-out by default because they are not expenses.
    return { ...row, duplicate, selfTransfer, selected: !selfTransfer };
  });
}

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  const dayFirst = trimmed.match(/^(\d{1,2})([/-])(\d{1,2})\2(\d{2}|\d{4})$/);
  const yearFirst = trimmed.match(/^(\d{4})([/-])(\d{1,2})\2(\d{1,2})$/);
  const monthName = trimmed.match(/^(\d{1,2})(?:\s+|-)([a-z]+)(?:\s+|-)(\d{4})$/i);
  if (!dayFirst && !yearFirst && !monthName) return null;

  const year = yearFirst
    ? Number(yearFirst[1])
    : monthName
      ? Number(monthName[3])
      : Number(dayFirst![4]!.length === 2 ? `20${dayFirst![4]}` : dayFirst![4]);
  const monthNames = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  const namedMonth = monthName
    ? monthNames.indexOf(monthName[2]!.slice(0, 3).toLowerCase()) + 1
    : 0;
  if (monthName && (namedMonth === 0 || ![
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ].some((name) => name === monthName[2]!.toLowerCase() || name.slice(0, 3) === monthName[2]!.toLowerCase()))) {
    return null;
  }
  const month = Number(yearFirst ? yearFirst[3] : monthName ? namedMonth : dayFirst![3]);
  const day = Number(yearFirst ? yearFirst[4] : monthName ? monthName[1] : dayFirst![1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString();
}

const normalizedHeader = (value: string) => clean(value).toLowerCase().replace(/\s*\/\s*/g, "/");
const exactColumn = (headers: string[], allowed: readonly string[]) =>
  headers.findIndex((header) => allowed.includes(header));

function resolveAdapterHeader(table: string[][], adapter: BankStatementAdapter) {
  for (let headerIndex = 0; headerIndex < table.length; headerIndex++) {
    const headers = table[headerIndex]!.map(normalizedHeader);
    const dateIndex = exactColumn(headers, adapter.dateHeaders);
    const descriptionIndex = exactColumn(headers, adapter.descriptionHeaders);
    if (dateIndex < 0 || descriptionIndex < 0) continue;
    for (const strategy of adapter.directions) {
      if (strategy.kind === "debit-column") {
        const debitIndex = exactColumn(headers, strategy.debitHeaders);
        if (debitIndex >= 0) return { headerIndex, dateIndex, descriptionIndex, debitIndex, amountIndex: -1, indicatorIndex: -1, strategy };
      } else {
        const amountIndex = exactColumn(headers, strategy.amountHeaders);
        const indicatorIndex = exactColumn(headers, strategy.indicatorHeaders);
        if (amountIndex >= 0 && indicatorIndex >= 0) {
          return { headerIndex, dateIndex, descriptionIndex, debitIndex: -1, amountIndex, indicatorIndex, strategy };
        }
      }
    }
  }
  return null;
}

function rowsFromTable(table: string[][], fileType: "csv" | "pdf", bank: SupportedBank, importId: string) {
  const adapter = bankStatementAdapters[bank];
  const resolved = resolveAdapterHeader(table, adapter);
  if (!resolved) {
    throw new Error(`The ${bank} statement layout is not recognized. Download the transaction-detail export for this bank.`);
  }
  const { headerIndex, dateIndex, descriptionIndex, debitIndex, amountIndex, indicatorIndex, strategy } = resolved;
  const parsed: BankStatementRow[] = [];
  const issues: BankStatementReviewIssue[] = [];
  let candidateDebitRows = 0;
  for (let index = headerIndex + 1; index < table.length; index++) {
    const source = table[index];
    const date = parseDate(source[dateIndex] ?? "");
    const description = clean(source[descriptionIndex] ?? "").slice(0, BANK_STATEMENT_LIMITS.note);
    const debitValue = debitIndex >= 0 ? amount(source[debitIndex] ?? "") : amount(source[amountIndex] ?? "");
    const rawIndicator = indicatorIndex >= 0 ? clean(source[indicatorIndex] ?? "") : "";
    const indicator = rawIndicator.toLowerCase();
    const rawAmount = clean(source[debitIndex >= 0 ? debitIndex : amountIndex] ?? "");
    const knownCreditIndicator = /^(?:cr|credit|c)$/.test(indicator);
    const unknownDirection = strategy.kind === "amount-indicator"
      && Boolean(rawAmount)
      && Boolean(indicator)
      && !strategy.debitIndicators.includes(indicator)
      && !knownCreditIndicator;
    if (unknownDirection) {
      candidateDebitRows++;
      issues.push({
        row: index + 1,
        field: "direction",
        value: rawIndicator,
        message: "Skipped transaction: direction marker is not recognized as debit or credit.",
      });
      continue;
    }
    const isDebitCandidate = strategy.kind === "debit-column"
      ? Boolean(rawAmount)
      : strategy.debitIndicators.includes(indicator);
    if (!isDebitCandidate) continue;
    candidateDebitRows++;
    if (!date) {
      issues.push({
        row: index + 1,
        field: "date",
        value: clean(source[dateIndex] ?? ""),
        message: "Skipped debit: date is invalid or uses an unsupported format.",
      });
    }
    if (!debitValue) {
      issues.push({
        row: index + 1,
        field: "amount",
        value: rawAmount,
        message: "Skipped debit: amount must be a positive number.",
      });
    }
    if (!description) {
      issues.push({
        row: index + 1,
        field: "description",
        value: "",
        message: "Skipped debit: description is missing.",
      });
    }
    // Amount-only exports are directional only when an explicit debit marker
    // is present. Credits/CR are never silently treated as expenses.
    if (!date || !description || !debitValue) continue;
    const merchant = (clean(description.split(/(?:\/|-|:|\bref(?:erence)?\b)/i)[0]) || "Bank transaction")
      .slice(0, BANK_STATEMENT_LIMITS.merchant);
    if (parsed.length >= BANK_STATEMENT_LIMITS.rows) {
      throw new Error(`This statement has more than ${BANK_STATEMENT_LIMITS.rows.toLocaleString()} transactions.`);
    }
    parsed.push({
      id: `${index}-${date.slice(0, 10)}-${debitValue}`,
      date, amount: debitValue, merchant, description,
      category: categoryFor(description),
      confidence: debitIndex >= 0 ? 0.94 : 0.82,
      duplicate: false, selfTransfer: false, selected: true,
      provenance: { fileType, row: index + 1 },
      importId, bank, parserVersion: `${adapter.version}-${fileType}`, sourceRowId: String(index + 1),
    });
  }
  if (!candidateDebitRows) throw new Error("No debit transactions were found. Credits are not imported as expenses.");
  return { rows: parsed, issues };
}

type PositionedPdfCell = { text: string; x: number; y: number };
type ExtractedPdf = { text: string; positionedRows: PositionedPdfCell[][] };

async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
  const raw = new TextDecoder("latin1").decode(bytes);
  if (/\/Encrypt\b/.test(raw)) throw new Error("This PDF is encrypted or password-protected. Remove the password and try again.");
  if (!raw.startsWith("%PDF-")) throw new Error("The selected file is not a valid PDF.");
  const positionedRows: PositionedPdfCell[][] = [];
  let text = "";
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "../../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
    const document = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageCells = content.items.flatMap((item) => {
        if (!("str" in item) || !clean(item.str)) return [];
        return [{ text: clean(item.str), x: item.transform[4], y: item.transform[5] }];
      });
      pageCells.sort((left, right) => Math.abs(left.y - right.y) > 2 ? right.y - left.y : left.x - right.x);
      const pageRows: PositionedPdfCell[][] = [];
      for (const cell of pageCells) {
        const row = pageRows.find((candidate) => Math.abs((candidate[0]?.y ?? 0) - cell.y) <= 2);
        if (row) row.push(cell);
        else pageRows.push([cell]);
      }
      positionedRows.push(...pageRows);
    }
    for (const row of positionedRows) row.sort((left, right) => left.x - right.x);
    text = positionedRows.map((row) => row.map((cell) => cell.text).join(" ")).join("\n");
    document.cleanup();
    await loadingTask.destroy();
  } catch (reason) {
    if (reason instanceof Error && /password/i.test(`${reason.name} ${reason.message}`)) {
      throw new Error("This PDF is encrypted or password-protected. Remove the password and try again.");
    }
    text = [...raw.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*Tj|\[((?:[^\]]|\](?!\s*TJ))*)\]\s*TJ/g)]
      .flatMap((match) => match[1] ? [match[1]] : [...(match[2] ?? "").matchAll(/\(([^()]*)\)/g)].map((part) => part[1]))
      .map((value) => value.replace(/\\([()\\])/g, "$1").replace(/\\[nrt]/g, " "))
      .join("\n");
  }
  if (text.length < 40) throw new Error("This PDF has no extractable text. Download a text-based PDF or CSV; scanned statements are unsupported.");
  if (!positionedRows.length) {
    throw new Error("This PDF's transaction columns cannot be aligned safely. Download the CSV statement instead.");
  }
  return { text, positionedRows };
}

function pdfTable(rows: PositionedPdfCell[][], adapter: BankStatementAdapter): string[][] {
  const permittedHeaders = new Set([
    ...adapter.dateHeaders,
    ...adapter.descriptionHeaders,
    ...adapter.directions.flatMap((strategy) => strategy.kind === "debit-column"
      ? strategy.debitHeaders
      : [...strategy.amountHeaders, ...strategy.indicatorHeaders]),
    "credit", "deposit", "deposit amount", "balance",
  ]);
  const headerIndex = rows.findIndex((row) => {
    const values = row.map((cell) => normalizedHeader(cell.text));
    return values.some((value) => adapter.dateHeaders.includes(value))
      && values.some((value) => adapter.descriptionHeaders.includes(value))
      && values.filter((value) => permittedHeaders.has(value)).length >= 3;
  });
  if (headerIndex < 0) {
    throw new Error(`The ${adapter.bank} PDF column geometry is not recognized. Download the CSV statement instead.`);
  }
  const headerCells = rows[headerIndex]!.filter((cell) => permittedHeaders.has(normalizedHeader(cell.text)));
  if (headerCells.length < 3) {
    throw new Error(`The ${adapter.bank} PDF columns cannot be aligned safely. Download the CSV statement instead.`);
  }
  const boundaries = headerCells.slice(0, -1).map((cell, index) => (cell.x + headerCells[index + 1]!.x) / 2);
  return rows.slice(headerIndex).map((row, relativeIndex) => {
    if (relativeIndex === 0) return headerCells.map((cell) => cell.text);
    const cells = Array.from({ length: headerCells.length }, () => "");
    for (const item of row) {
      if (boundaries.some((boundary) => Math.abs(item.x - boundary) <= 3)) {
        throw new Error(`A ${adapter.bank} PDF transaction row cannot be aligned unambiguously. Download the CSV statement instead.`);
      }
      const columnIndex = boundaries.findIndex((boundary) => item.x < boundary);
      const target = columnIndex < 0 ? headerCells.length - 1 : columnIndex;
      cells[target] = clean(`${cells[target]} ${item.text}`);
    }
    return cells;
  });
}

export async function parseBankStatementFile(file: File, existing: Expense[] = []): Promise<BankStatementReview> {
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "csv" && extension !== "pdf") throw new Error("Unsupported file type. Choose a CSV or text-based PDF statement.");
  const limit = extension === "csv" ? BANK_STATEMENT_LIMITS.csvBytes : BANK_STATEMENT_LIMITS.pdfBytes;
  if (file.size > limit) throw new Error(`This ${extension.toUpperCase()} exceeds the ${limit / 1024 / 1024} MiB file limit.`);
  if (file.size === 0) throw new Error("The selected statement is empty.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const importId = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const extractedPdf = extension === "pdf" ? await extractPdf(bytes) : null;
  const text = extractedPdf?.text ?? new TextDecoder().decode(bytes);
  const bank = detectBank(text);
  const adapter = bankStatementAdapters[bank];
  const table = extension === "csv" ? parseCsv(text) : pdfTable(extractedPdf!.positionedRows, adapter);
  const { rows, issues } = rowsFromTable(table, extension, bank, importId);
  const flagged = markFlags(rows, existing);
  const skippedRows = new Set(issues.map((issue) => issue.row)).size;
  const parsedConfidence = flagged.length
    ? flagged.reduce((sum, row) => sum + row.confidence, 0) / flagged.length
    : 0;
  return {
    bank,
    version: `${bankStatementAdapters[bank].version}-${extension}`,
    importId,
    confidence: parsedConfidence * (flagged.length / (flagged.length + skippedRows)),
    rows: flagged,
    issues,
  };
}

export function bankRowsToExpenses(rows: BankStatementRow[]) {
  return rows.filter((row) => row.selected).map((row) => ({
    date: row.date,
    amount: row.amount,
    category: row.category,
    merchant: row.merchant,
    paymentMethod: "Bank transfer",
    note: row.description,
    importId: row.importId,
    sourceRowId: row.sourceRowId,
    bank: row.bank,
    parserVersion: row.parserVersion,
    reimbursable: false,
    recurring: false,
  }));
}

export function bankStatementDateInputValue(value: string): string {
  const parsed = parseDate(value);
  return parsed ?? "";
}

export function prepareBankStatementCommit(review: BankStatementReview | null) {
  if (!review) throw new Error("Review the parsed statement before saving.");
  const invalid = review.rows.some((row) =>
    row.selected && (
      !bankStatementDateInputValue(row.date.slice(0, 10))
      ||
      !row.merchant.trim() || row.merchant.trim().length > BANK_STATEMENT_LIMITS.merchant
      || !row.category.trim() || row.category.trim().length > BANK_STATEMENT_LIMITS.category
      || row.description.length > BANK_STATEMENT_LIMITS.note
      || !Number.isFinite(row.amount) || row.amount <= 0
    ));
  if (invalid) {
    throw new Error(
      `Correct selected dates and amounts, and keep merchants within ${BANK_STATEMENT_LIMITS.merchant} characters, categories within ${BANK_STATEMENT_LIMITS.category}, and notes within ${BANK_STATEMENT_LIMITS.note}.`,
    );
  }
  const expenses = bankRowsToExpenses(review.rows);
  if (!expenses.length) throw new Error("Select at least one reviewed debit transaction.");
  return expenses;
}