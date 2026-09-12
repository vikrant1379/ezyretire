import type { FinancialData } from "./financial-api.ts";

export const CURRENT_FINANCIAL_BACKUP_VERSION = 2;

type VersionedFinancialBackup = {
  formatVersion: number;
  data: unknown;
};

export function serializeFinancialBackup(data: FinancialData): string {
  return JSON.stringify({
    formatVersion: CURRENT_FINANCIAL_BACKUP_VERSION,
    data,
  }, null, 2);
}

export function parseFinancialBackup(contents: string): FinancialData {
  const parsed: unknown = JSON.parse(contents);

  if (isVersionedBackup(parsed)) {
    if (parsed.formatVersion !== 1 && parsed.formatVersion !== CURRENT_FINANCIAL_BACKUP_VERSION) {
      throw new Error(
        `This backup uses unsupported format version ${parsed.formatVersion}. `
        + `This version of ezyRetire supports backup format version ${CURRENT_FINANCIAL_BACKUP_VERSION}.`,
      );
    }
    return validateFinancialData(parsed.data, parsed.formatVersion);
  }

  return migrateLegacyBackup(parsed);
}

function isVersionedBackup(value: unknown): value is VersionedFinancialBackup {
  return (
    typeof value === "object"
    && value !== null
    && "formatVersion" in value
  );
}

function migrateLegacyBackup(value: unknown): FinancialData {
  // Backups created before format versioning are the supported version 0 format.
  return validateFinancialData(value, 0);
}

function validateFinancialData(value: unknown, version: number): FinancialData {
  if (typeof value !== "object" || value === null) {
    throw new Error("This is not a valid ezyRetire backup.");
  }

  const parsed = value as Partial<FinancialData>;
  if (
    !Array.isArray(parsed.expenses)
    || !Array.isArray(parsed.investments)
    || !Array.isArray(parsed.incomeSources)
    || typeof parsed.retirementInputs !== "object"
    || parsed.retirementInputs === null
    || typeof parsed.profileInputs !== "object"
    || parsed.profileInputs === null
  ) {
    throw new Error("This is not a valid ezyRetire backup.");
  }
  return {
    ...parsed,
    incomeReceipts: version >= 2 && Array.isArray(parsed.incomeReceipts)
      ? parsed.incomeReceipts
      : [],
  } as FinancialData;
}