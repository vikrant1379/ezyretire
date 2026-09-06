import type { Expense } from "./storage.ts";

export type ImportedExpense = Omit<Expense, "id" | "createdAt"> &
  Partial<Pick<Expense, "id" | "createdAt">>;

const normalizeText = (value: string | undefined) =>
  (value ?? "").trim().toLowerCase();

const normalizedDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
};

export function expenseImportFingerprint(
  expense: Omit<Expense, "id" | "createdAt">,
) {
  return [
    normalizedDate(expense.date),
    Number(expense.amount).toFixed(2),
    normalizeText(expense.category),
    normalizeText(expense.merchant),
    normalizeText(expense.paymentMethod),
    normalizeText(expense.note),
    expense.reimbursable ? "1" : "0",
    expense.recurring ? "1" : "0",
    normalizeText(expense.linkedLoanId),
  ].join("|");
}

export function mergeImportedExpenses(
  existing: Expense[],
  incoming: ImportedExpense[],
  idFactory: () => string,
  now = new Date().toISOString(),
) {
  const existingIds = new Set(existing.map((expense) => expense.id));
  const existingFingerprintCounts = new Map<string, number>();
  const incomingFingerprintCounts = new Map<string, number>();
  const added: Expense[] = [];
  let duplicateCount = 0;

  for (const expense of existing) {
    const fingerprint = expenseImportFingerprint(expense);
    existingFingerprintCounts.set(
      fingerprint,
      (existingFingerprintCounts.get(fingerprint) ?? 0) + 1,
    );
  }

  for (const expense of incoming) {
    const fingerprint = expenseImportFingerprint(expense);
    const occurrence = (incomingFingerprintCounts.get(fingerprint) ?? 0) + 1;
    incomingFingerprintCounts.set(fingerprint, occurrence);

    const requestedId = expense.id?.trim();
    const duplicatesExistingId = Boolean(
      requestedId && existingIds.has(requestedId),
    );
    const duplicatesLegacyRow =
      !requestedId &&
      occurrence <= (existingFingerprintCounts.get(fingerprint) ?? 0);

    if (duplicatesExistingId || duplicatesLegacyRow) {
      duplicateCount++;
      continue;
    }

    let id = requestedId || idFactory();
    while (existingIds.has(id)) id = idFactory();

    const createdAtDate = expense.createdAt
      ? new Date(expense.createdAt)
      : null;
    const createdAt =
      createdAtDate && !Number.isNaN(createdAtDate.getTime())
        ? createdAtDate.toISOString()
        : now;
    const imported: Expense = {
      ...expense,
      id,
      createdAt,
    };
    existingIds.add(id);
    added.push(imported);
  }

  return {
    expenses: [...existing, ...added],
    added,
    duplicateCount,
  };
}

export function parseImportedExpenseDate(value: unknown) {
  let date: Date;

  if (typeof value === "number" && Number.isFinite(value)) {
    date = new Date(Math.round((value - 25569) * 86400 * 1000));
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    const indianDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (indianDate) {
      const [, day, month, year] = indianDate;
      date = new Date(
        Date.UTC(Number(year), Number(month) - 1, Number(day)),
      );
      if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() !== Number(month) - 1 ||
        date.getUTCDate() !== Number(day)
      ) {
        return null;
      }
    } else {
      date = new Date(trimmed);
    }
  } else {
    return null;
  }

  return Number.isNaN(date.getTime()) ? null : date;
}