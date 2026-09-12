import {
  db, usersTable, vaultDeletionJobsTable, vaultUploadGrantsTable,
} from "@workspace/db";
import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  clearFinancialData,
  deleteFinancialExpense,
  FinancialRestoreCollisionError,
  FinancialSaveSizeLimitError,
  GoalAllocationConflictError,
  isSupportedPushEndpoint,
  loadFinancialData,
  managePlanningCategory,
  NotificationStateNotFoundError,
  PlanningCategoryConflictError,
  restoreFinancialData,
  saveFinancialData,
  importBankStatementExpenses,
  updateFinancialHealthPlanning,
  updatePlanningFeatures,
  updateRetirementPlanning,
} from "../lib/finance-store.js";
import { premiumEntitlementsTable } from "@workspace/db";
import { sendMonthlyReportEmail } from "../lib/monthly-report-email.js";
import {
  classifyMonthlyReportDeliveryFailure,
  evaluatePlanningForAccount,
  getWebPushConfiguration,
} from "../lib/planning-jobs.js";
import { normalizeOptionalPhone } from "../lib/auth-profile-input.js";
import {
  assertPromotedVaultObject,
  assertVaultObject,
  createVaultDocumentPath,
  createVaultStagingPath,
  createVaultUploadUrl,
  markVaultOwner,
  promoteVaultObject,
  readVaultObjectBytes,
} from "../lib/object-storage.js";

const router: IRouter = Router();
const RESTORE_JSON_LIMIT = 12 * 1024 * 1024;
const RESTORE_UPLOAD_TYPE = "application/json";
const RESTORE_UPLOAD_GRANT_MS = 15 * 60_000;
const RESTORE_PROMOTION_LEASE_MS = 30 * 60_000;
const RESTORE_STAGING_GRACE_MS = 5 * 60_000;
const FINANCIAL_STREAM_CHUNK_BYTES = 64 * 1024;
const FINANCIAL_STREAM_HEADER = "x-financial-data-stream";
const INTERNAL_ADMISSION_LIMIT_LOCAL = "financialDocumentAdmissionLimit";
type MonthlyReportDeliveryMarker = (
  user: typeof usersTable.$inferSelect,
  month: string,
) => ReturnType<typeof updatePlanningFeatures>;
const defaultMonthlyReportDeliveryMarker: MonthlyReportDeliveryMarker = (user, month) =>
  updatePlanningFeatures(user, { monthlyReportEmailDeliveredMonth: month });
let monthlyReportDeliveryMarker = defaultMonthlyReportDeliveryMarker;

export function setMonthlyReportDeliveryMarkerForTests(
  marker?: MonthlyReportDeliveryMarker,
): void {
  monthlyReportDeliveryMarker = marker ?? defaultMonthlyReportDeliveryMarker;
}
type RestoreUploadCleanupContext = {
  grantId: string;
  stagingPath: string;
  promotedPath: string;
};
type MaterializedRestoreUpload = {
  payload: Record<string, unknown>;
  cleanupContext: RestoreUploadCleanupContext;
};

async function waitForFinancialDrain(res: Response): Promise<boolean> {
  if (res.destroyed || res.writableEnded) return false;
  return new Promise((resolve) => {
    const done = (writable: boolean) => {
      res.off("drain", drained);
      res.off("close", closed);
      res.off("error", closed);
      resolve(writable);
    };
    const drained = () => done(true);
    const closed = () => done(false);
    res.once("drain", drained);
    res.once("close", closed);
    res.once("error", closed);
  });
}

export async function sendFinancialDataStream(res: Response, data: unknown): Promise<void> {
  // Vercel's Node runtime forwards a header-flushed, lengthless sequence of
  // writes as a streaming response instead of buffering it under the 4.5 MiB
  // non-streaming response limit.
  const body = Buffer.from(JSON.stringify(data));
  res.status(200);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader(FINANCIAL_STREAM_HEADER, "1");
  res.removeHeader("content-length");
  res.flushHeaders();
  try {
    for (let offset = 0; offset < body.length; offset += FINANCIAL_STREAM_CHUNK_BYTES) {
      if (res.destroyed || res.writableEnded) return;
      const writable = res.write(body.subarray(
        offset, Math.min(offset + FINANCIAL_STREAM_CHUNK_BYTES, body.length),
      ));
      if (!writable && !await waitForFinancialDrain(res)) return;
    }
    if (!res.destroyed && !res.writableEnded) res.end();
  } catch {
    // A partial streamed JSON response cannot safely be replaced after headers.
    if (!res.destroyed) res.destroy();
  } finally {
    const settle = res.locals?.accountFenceSettle;
    if (typeof settle === "function") settle();
  }
}
const protectedPlanningCategories = new Set([
  "food & dining",
  "transportation",
  "shopping",
  "entertainment",
  "housing",
  "utilities",
  "health & wellness",
  "travel",
  "education",
  "miscellaneous",
  "home maintenance",
  "insurance",
  "family & caregiving",
  "domestic help",
  "taxes & fees",
]);

function requireUser(req: Request, res: Response): req is Request & Express.AuthedRequest {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Login required" });
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internalAdmissionLimit(res: Response): number | undefined {
  const value = res.locals[INTERNAL_ADMISSION_LIMIT_LOCAL];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isFiniteNumber(value: unknown, min = 0, max = Number.POSITIVE_INFINITY): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isValidEmergencyFund(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.targetMonths, 0, 24)
    && isFiniteNumber(value.reserveBalance)
    && isFiniteNumber(value.monthlyContribution);
}

function isValidNetWorthSnapshot(value: unknown): boolean {
  return isRecord(value)
    && typeof value.month === "string"
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)
    && isFiniteNumber(value.assets)
    && isFiniteNumber(value.liabilities)
    && (
      value.healthScore === undefined
      || isFiniteNumber(value.healthScore, 0, 100)
    );
}

function isValidPensionSources(value: unknown): boolean {
  return Array.isArray(value) && value.every((source) =>
    isRecord(source)
    && typeof source.id === "string"
    && source.id.trim().length > 0
    && typeof source.name === "string"
    && source.name.trim().length > 0
    && isFiniteNumber(source.monthlyAmount)
    && (
      source.startAge === undefined
      || isFiniteNumber(source.startAge, 18, 120)
    )
    && isFiniteNumber(source.annualEscalationRate, 0, 50)
  );
}

function isValidIncomeReceiptCollection(receipts: unknown, incomeSources: unknown): boolean {
  if (!Array.isArray(receipts) || receipts.length > 10_000 || !Array.isArray(incomeSources)) {
    return false;
  }
  const sourceIds = new Set<string>();
  for (const source of incomeSources) {
    if (!isRecord(source)
      || typeof source.id !== "string"
      || !source.id
      || source.id !== source.id.trim()
      || source.id.length > 120
      || sourceIds.has(source.id)
    ) {
      return false;
    }
    sourceIds.add(source.id);
  }
  const receiptIds = new Set<string>();
  return receipts.every((receipt) => {
    if (!isRecord(receipt)
      || typeof receipt.id !== "string"
      || !receipt.id
      || receipt.id !== receipt.id.trim()
      || receipt.id.length > 120
      || receiptIds.has(receipt.id)
      || typeof receipt.incomeSourceId !== "string"
      || receipt.incomeSourceId !== receipt.incomeSourceId.trim()
      || !sourceIds.has(receipt.incomeSourceId)
      || typeof receipt.receivedDate !== "string"
      || !isValidDate(receipt.receivedDate)
      || !isFiniteNumber(receipt.amount, 0, 999_999_999_999.99)
      || (receipt.note !== undefined
        && (typeof receipt.note !== "string" || receipt.note.length > 1_000))
      || typeof receipt.createdAt !== "string"
      || !Number.isFinite(new Date(receipt.createdAt).getTime())
    ) {
      return false;
    }
    receiptIds.add(receipt.id);
    return true;
  });
}

function isValidRetirementPlan(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const lifestyle = value.lifestyleChoice;
  return typeof value.dateOfBirth === "string"
    && isValidDate(value.dateOfBirth)
    && isFiniteNumber(value.targetRetirementAge, 18, 120)
    && Number.isInteger(value.targetRetirementAge)
    && isFiniteNumber(value.lifeExpectancy, value.targetRetirementAge as number, 130)
    && Number.isInteger(value.lifeExpectancy)
    && isFiniteNumber(value.generalInflation, 0, 25)
    && isFiniteNumber(value.salaryGrowth, 0, 100)
    && isFiniteNumber(value.monthlyContributionOverride)
    && typeof value.investSurplus === "boolean"
    && (
      lifestyle === "Basic"
      || lifestyle === "Comfortable"
      || lifestyle === "Premium"
      || lifestyle === "Custom"
    )
    && isFiniteNumber(value.customLifestyleExpense)
    && isValidPensionSources(value.pensionSources);
}

function isValidGoal(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string" && value.id.trim().length > 0 && value.id.length <= 120
    && typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 160
    && typeof value.targetDate === "string" && isValidDate(value.targetDate)
    && isFiniteNumber(value.targetAmount) && Number(value.targetAmount) > 0
    && isFiniteNumber(value.currentAmount)
    && isFiniteNumber(value.monthlyAllocation)
    && isFiniteNumber(value.annualInflationRate, 0, 25)
    && isFiniteNumber(value.priority, 1, 1000) && Number.isInteger(value.priority);
}

function isValidReminder(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string" && value.id.trim().length > 0 && value.id.length <= 120
    && typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= 160
    && typeof value.date === "string" && isValidDate(value.date)
    && (value.amount === undefined || isFiniteNumber(value.amount))
    && (value.notes === undefined || (typeof value.notes === "string" && value.notes.length <= 1000))
    && ["none", "monthly", "yearly"].includes(String(value.recurrence))
    && typeof value.enabled === "boolean";
}

function isValidNotificationPreferences(value: unknown): boolean {
  if (!isRecord(value) || typeof value.enabled !== "boolean"
    || !isRecord(value.types) || !isRecord(value.quietHours)) return false;
  const bool = (item: unknown) => typeof item === "boolean";
  const time = (item: unknown) => typeof item === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(item);
  let validTimeZone = false;
  if (typeof value.timeZone === "string") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format();
      validTimeZone = true;
    } catch {
      validTimeZone = false;
    }
  }
  return bool(value.inApp) && bool(value.push)
    && ["budget", "retirement", "goal", "upcoming", "milestone", "tax", "anomaly"]
      .every((key) => bool((value.types as Record<string, unknown>)[key]))
    && time(value.quietHours.start) && time(value.quietHours.end)
    && bool(value.weeklyDigest)
    && bool(value.monthlyReportEmail)
    && isFiniteNumber(value.digestDay, 0, 6) && Number.isInteger(value.digestDay)
    && validTimeZone && (value.timeZone as string).length <= 100;
}

function isValidNotification(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string" && value.id.trim().length > 0 && value.id.length <= 120
    && typeof value.dedupeKey === "string" && value.dedupeKey.trim().length > 0 && value.dedupeKey.length <= 200
    && ["budget", "retirement", "goal", "upcoming", "milestone", "tax", "anomaly"]
      .includes(String(value.type))
    && typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= 160
    && typeof value.message === "string" && value.message.trim().length > 0 && value.message.length <= 1000
    && typeof value.createdAt === "string" && Number.isFinite(new Date(value.createdAt).getTime())
    && typeof value.deliverAfter === "string" && Number.isFinite(new Date(value.deliverAfter).getTime())
    && Array.isArray(value.channels)
    && value.channels.every((channel) => channel === "in-app" || channel === "push");
}

function isValidPushSubscription(value: unknown): boolean {
  return isRecord(value)
    && isSupportedPushEndpoint(value.endpoint)
    && typeof value.p256dh === "string" && value.p256dh.length > 0 && value.p256dh.length <= 512
    && typeof value.auth === "string" && value.auth.length > 0 && value.auth.length <= 512
    && (value.expirationTime === undefined || value.expirationTime === null
      || isFiniteNumber(value.expirationTime));
}

function isValidMonthlyReport(value: unknown): boolean {
  if (!isRecord(value) || typeof value.month !== "string"
    || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month) || !Array.isArray(value.sections)) return false;
  const expected = new Set([
    "income-vs-expected",
    "expenses-vs-budget-category",
    "savings-amount-rate",
    "portfolio-value-returns-change",
    "net-worth-change",
    "retirement-date-movement",
    "health-score-change",
    "top-next-month-actions",
  ]);
  const ids = value.sections.filter(isRecord).map((section) => section.id);
  return value.sections.length === 8 && value.sections.every((section) =>
    isRecord(section)
    && typeof section.id === "string" && expected.has(section.id)
    && typeof section.title === "string" && section.title.length <= 160
    && isRecord(section.metrics)
    && Object.values(section.metrics).every((metric) => isFiniteNumber(metric, -1e15, 1e15))
    && isRecord(section.metricFormats)
    && Object.entries(section.metrics).every(([key]) =>
      ["currency", "percent", "count", "number"].includes(
        String((section.metricFormats as Record<string, unknown>)[key]),
      ))
    && Array.isArray(section.actions)
    && section.actions.every((action) => typeof action === "string" && action.length <= 500))
    && new Set(ids).size === 8
    && JSON.stringify(value).length <= 500_000;
}

async function loadUser(userId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user;
}

router.get("/financial-data", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  await sendFinancialDataStream(res, await loadFinancialData(user));
});

router.post("/financial-data/bank-statement-import", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const expectedAccountId = typeof req.body?.expectedAccountId === "string"
    ? req.body.expectedAccountId.trim()
    : "";
  if (!expectedAccountId) {
    res.status(400).json({ error: "Expected account ID is required" });
    return;
  }
  if (expectedAccountId !== req.user.id) {
    res.status(409).json({ error: "The signed-in account changed before this import could be saved" });
    return;
  }
  const [entitlement] = await db.select().from(premiumEntitlementsTable)
    .where(eq(premiumEntitlementsTable.userId, req.user.id));
  if (!entitlement?.active || entitlement.plan !== "premium"
    || (entitlement.validUntil && entitlement.validUntil <= new Date())) {
    res.status(403).json({ error: "An active premium plan is required for bank statement import" });
    return;
  }
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 5_000) {
    res.status(400).json({ error: "Reviewed bank statement rows must contain 1-5,000 entries" });
    return;
  }
  let validationError = "";
  const normalized = rows.map((row: unknown, index: number) => {
    const invalid = (message: string) => {
      if (!validationError) validationError = `Reviewed row ${index + 1}: ${message}`;
      return null;
    };
    if (!isRecord(row)) return invalid("must be an object");
    const date = typeof row.date === "string" ? row.date : "";
    const amount = row.amount;
    const merchant = typeof row.merchant === "string" ? row.merchant.trim() : "";
    const category = typeof row.category === "string" ? row.category.trim() : "";
    const paymentMethod = typeof row.paymentMethod === "string" ? row.paymentMethod.trim() : "";
    const note = row.note === undefined ? undefined : typeof row.note === "string" ? row.note : null;
    const importId = typeof row.importId === "string" ? row.importId.trim() : "";
    const sourceRowId = typeof row.sourceRowId === "string" ? row.sourceRowId.trim() : "";
    const bank = typeof row.bank === "string" ? row.bank.trim() : "";
    const parserVersion = typeof row.parserVersion === "string" ? row.parserVersion.trim() : "";
    if (!isValidDate(date.slice(0, 10))) return invalid("date must be a valid date");
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0
      || amount > 999_999_999_999.99) return invalid("amount is out of range");
    if (!merchant) return invalid("merchant is required");
    if (merchant.length > 160) return invalid("merchant must be at most 160 characters");
    if (!category) return invalid("category is required");
    if (category.length > 80) return invalid("category must be at most 80 characters");
    if (!paymentMethod) return invalid("payment method is required");
    if (paymentMethod.length > 80) return invalid("payment method must be at most 80 characters");
    if (note === null) return invalid("note must be text");
    if (note !== undefined && note.length > 2_000) return invalid("note must be at most 2000 characters");
    if (row.reimbursable !== undefined && typeof row.reimbursable !== "boolean") return invalid("reimbursable must be boolean");
    if (row.recurring !== undefined && typeof row.recurring !== "boolean") return invalid("recurring must be boolean");
    if (!/^[a-f0-9]{64}$/i.test(importId)) return invalid("import ID must be 64 hexadecimal characters");
    if (!sourceRowId || sourceRowId.length > 256) return invalid("source row ID must contain 1-256 characters");
    if (!/^(?:SBI|HDFC|ICICI|Axis|Kotak|PNB|BOB|IndusInd)$/.test(bank)) return invalid("bank is unsupported");
    if (!/^[a-z0-9-]{3,64}$/i.test(parserVersion)) return invalid("parser version is invalid");
    return {
      importId, sourceRowId, bank, parserVersion, date: date.slice(0, 10), amount: Number(amount.toFixed(2)), category, merchant,
      paymentMethod, note, reimbursable: row.reimbursable, recurring: row.recurring,
    };
  });
  if (normalized.some((row) => row === null)) {
    res.status(400).json({ error: validationError });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  try {
    const result = await importBankStatementExpenses(
      user,
      normalized as NonNullable<typeof normalized[number]>[],
      internalAdmissionLimit(res),
    );
    await sendFinancialDataStream(res, result);
  } catch (error) {
    if (error instanceof FinancialSaveSizeLimitError) {
      res.status(413).json({
        error: error.message,
        code: error.code,
        limitBytes: error.limitBytes,
      });
      return;
    }
    throw error;
  }
});

router.post("/financial-data/restore-uploads/request-url", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const size = Number(req.body?.size);
  if (!Number.isInteger(size) || size < 1 || size > RESTORE_JSON_LIMIT) {
    res.status(400).json({ error: "Restore upload size must be between 1 byte and 12 MiB" });
    return;
  }
  const objectPath = createVaultStagingPath();
  const expiresAt = new Date(Date.now() + RESTORE_UPLOAD_GRANT_MS);
  const [grant] = await db.insert(vaultUploadGrantsTable).values({
    userId: req.user.id,
    objectPath,
    name: "financial-data-restore.json",
    contentType: RESTORE_UPLOAD_TYPE,
    size,
    purpose: "financial_restore",
    expiresAt,
  }).returning({ id: vaultUploadGrantsTable.id });
  try {
    const upload = await createVaultUploadUrl(
      req.user.id, "financial_restore", size, RESTORE_UPLOAD_TYPE, objectPath, expiresAt,
    );
    res.json({ ...upload, metadata: { size, contentType: RESTORE_UPLOAD_TYPE } });
  } catch {
    await db.delete(vaultUploadGrantsTable).where(and(
      eq(vaultUploadGrantsTable.id, grant.id),
      eq(vaultUploadGrantsTable.userId, req.user.id),
      isNull(vaultUploadGrantsTable.consumedAt),
    )).catch(() => undefined);
    res.status(503).json({ error: "Storage provider is temporarily unavailable" });
  }
});

async function materializeRestoreUpload(
  userId: string, reference: Record<string, unknown>,
): Promise<MaterializedRestoreUpload> {
  const objectPath = typeof reference.objectPath === "string" ? reference.objectPath : "";
  const size = Number(reference.size);
  if (!Number.isInteger(size) || size < 1 || size > RESTORE_JSON_LIMIT) {
    throw new Error("RESTORE_UPLOAD_INVALID");
  }
  const [grant] = await db.select().from(vaultUploadGrantsTable).where(and(
    eq(vaultUploadGrantsTable.userId, userId),
    eq(vaultUploadGrantsTable.objectPath, objectPath),
    eq(vaultUploadGrantsTable.purpose, "financial_restore"),
    eq(vaultUploadGrantsTable.size, size),
    eq(vaultUploadGrantsTable.contentType, RESTORE_UPLOAD_TYPE),
  ));
  if (!grant) throw new Error("RESTORE_UPLOAD_NOT_FOUND");
  if (grant.consumedAt) {
    if (!grant.promotedObjectPath) throw new Error("RESTORE_UPLOAD_NOT_FOUND");
    await assertPromotedVaultObject(
      grant.promotedObjectPath, size, RESTORE_UPLOAD_TYPE, userId,
    );
    const replayBytes = await readVaultObjectBytes(
      userId, grant.promotedObjectPath, RESTORE_JSON_LIMIT,
    );
    let replayPayload: unknown;
    try { replayPayload = JSON.parse(replayBytes.toString("utf8")); } catch {
      throw new Error("RESTORE_UPLOAD_INVALID_JSON");
    }
    if (!isRecord(replayPayload)) throw new Error("RESTORE_UPLOAD_INVALID_JSON");
    return {
      payload: replayPayload,
      cleanupContext: {
        grantId: grant.id, stagingPath: grant.objectPath,
        promotedPath: grant.promotedObjectPath,
      },
    };
  }
  if (grant.expiresAt <= new Date()) throw new Error("RESTORE_UPLOAD_NOT_FOUND");
  const promotedPath = createVaultDocumentPath();
  const claimedAt = new Date();
  const promotionFinalizeAfter = new Date(claimedAt.getTime() + RESTORE_PROMOTION_LEASE_MS);
  const stagingFinalizeAfter = new Date(
    grant.expiresAt.getTime() + RESTORE_STAGING_GRACE_MS,
  );
  const claimed = await db.transaction(async (tx) => {
    const [reserved] = await tx.update(vaultUploadGrantsTable).set({
      claimedAt,
      promotedObjectPath: promotedPath,
    }).where(and(
      eq(vaultUploadGrantsTable.id, grant.id),
      eq(vaultUploadGrantsTable.userId, userId),
      eq(vaultUploadGrantsTable.objectPath, objectPath),
      eq(vaultUploadGrantsTable.purpose, "financial_restore"),
      eq(vaultUploadGrantsTable.size, size),
      eq(vaultUploadGrantsTable.contentType, RESTORE_UPLOAD_TYPE),
      isNull(vaultUploadGrantsTable.claimedAt),
      isNull(vaultUploadGrantsTable.consumedAt),
      isNull(vaultUploadGrantsTable.promotedObjectPath),
      gt(vaultUploadGrantsTable.expiresAt, claimedAt),
    )).returning({ id: vaultUploadGrantsTable.id });
    if (!reserved) return false;
    await tx.insert(vaultDeletionJobsTable).values({
      userId, objectPath: promotedPath, reason: "promotion_rollback",
      finalizeAfter: promotionFinalizeAfter,
    });
    await tx.insert(vaultDeletionJobsTable).values({
      userId, objectPath, reason: "financial_restore_staging_rollback",
      finalizeAfter: stagingFinalizeAfter,
    });
    return true;
  });
  if (!claimed) throw new Error("RESTORE_UPLOAD_IN_PROGRESS");
  const handle = await assertVaultObject(
    objectPath, size, RESTORE_UPLOAD_TYPE, undefined, userId, "financial_restore",
  );
  await markVaultOwner(handle, userId);
  await promoteVaultObject(handle, objectPath, promotedPath, userId);
  await assertPromotedVaultObject(promotedPath, size, RESTORE_UPLOAD_TYPE, userId);
  const bytes = await readVaultObjectBytes(userId, promotedPath, RESTORE_JSON_LIMIT);
  let payload: unknown;
  try {
    payload = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("RESTORE_UPLOAD_INVALID_JSON");
  }
  if (!isRecord(payload)) throw new Error("RESTORE_UPLOAD_INVALID_JSON");
  const [consumed] = await db.update(vaultUploadGrantsTable).set({
    consumedAt: new Date(),
  }).where(and(
    eq(vaultUploadGrantsTable.id, grant.id),
    eq(vaultUploadGrantsTable.userId, userId),
    eq(vaultUploadGrantsTable.objectPath, objectPath),
    eq(vaultUploadGrantsTable.promotedObjectPath, promotedPath),
    isNotNull(vaultUploadGrantsTable.claimedAt),
    isNull(vaultUploadGrantsTable.consumedAt),
  )).returning({ id: vaultUploadGrantsTable.id });
  if (!consumed) throw new Error("RESTORE_UPLOAD_CLAIM_LOST");
  return {
    payload,
    cleanupContext: { grantId: grant.id, stagingPath: objectPath, promotedPath },
  };
}

async function completeRestoreUploadCleanup(
  userId: string, cleanup: RestoreUploadCleanupContext,
): Promise<void> {
  await db.update(vaultDeletionJobsTable).set({
    reason: "financial_restore_complete", finalizeAfter: new Date(),
  }).where(and(
    eq(vaultDeletionJobsTable.userId, userId),
    eq(vaultDeletionJobsTable.objectPath, cleanup.promotedPath),
    inArray(vaultDeletionJobsTable.reason, ["promotion_rollback", "financial_restore_complete"]),
  ));
  await db.update(vaultDeletionJobsTable).set({
    reason: "financial_restore_complete",
  }).where(and(
    eq(vaultDeletionJobsTable.userId, userId),
    eq(vaultDeletionJobsTable.objectPath, cleanup.stagingPath),
    inArray(vaultDeletionJobsTable.reason, [
      "financial_restore_staging_rollback", "financial_restore_complete",
    ]),
  ));
}

async function writeFinancialData(
  req: Request,
  res: Response,
  restore: boolean,
): Promise<void> {
  if (!requireUser(req, res)) return;
  if (!isRecord(req.body)) {
    res.status(400).json({ error: "Invalid financial data payload" });
    return;
  }

  let payload = req.body;
  let restoreUploadCleanup: RestoreUploadCleanupContext | undefined;
  if (restore && Object.keys(payload).length === 1 && isRecord(payload.restoreUpload)) {
    try {
      const materialized = await materializeRestoreUpload(req.user.id, payload.restoreUpload);
      payload = materialized.payload;
      restoreUploadCleanup = materialized.cleanupContext;
    } catch {
      res.status(404).json({ error: "Restore upload was not found or could not be verified" });
      return;
    }
  } else if (restore && payload.restoreUpload !== undefined) {
    res.status(400).json({ error: "Restore upload envelope is invalid" });
    return;
  }
  if (payload.incomeReceipts !== undefined
    && !isValidIncomeReceiptCollection(payload.incomeReceipts, payload.incomeSources)) {
    res.status(400).json({
      error: "Income receipts contain invalid, duplicate, or unlinked entries. Review them and try again.",
    });
    return;
  }
  if (payload.goals !== undefined && (
    !Array.isArray(payload.goals)
    || payload.goals.length > 100
    || !payload.goals.every(isValidGoal)
    || new Set(payload.goals.map((goal) => (goal as Record<string, unknown>).id)).size !== payload.goals.length
  )) {
    res.status(400).json({ error: "Goals contain invalid or duplicate entries. Review the highlighted fields and try again." });
    return;
  }
  for (const reminderCollection of [payload.reminders, payload.customReminders]) {
    if (reminderCollection !== undefined && (
      !Array.isArray(reminderCollection)
      || reminderCollection.length > 500
      || !reminderCollection.every(isValidReminder)
      || new Set(reminderCollection.map((reminder) => (reminder as Record<string, unknown>).id)).size !== reminderCollection.length
    )) {
      res.status(400).json({ error: "Reminders contain invalid or duplicate entries. Review the fields and try again." });
      return;
    }
  }
  const profileInputs = isRecord(payload.profileInputs) ? payload.profileInputs : {};
  const retirementInputs = isRecord(payload.retirementInputs) ? payload.retirementInputs : {};
  const dateOfBirthInput = profileInputs.dateOfBirth ?? retirementInputs.dateOfBirth;
  if (typeof dateOfBirthInput === "string" && !isValidDate(dateOfBirthInput)) {
    res.status(400).json({ error: "dateOfBirth must be in YYYY-MM-DD format" });
    return;
  }

  const fullNameInput = profileInputs.fullName;
  if (
    fullNameInput !== undefined &&
    (typeof fullNameInput !== "string" || fullNameInput.trim().length < 2 || fullNameInput.trim().length > 100)
  ) {
    res.status(400).json({ error: "fullName must be 2-100 characters when provided" });
    return;
  }

  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const phoneInput = typeof profileInputs.phone === "string"
    ? normalizeOptionalPhone(profileInputs.phone)
    : undefined;
  if (restore) {
    try {
      const restored = await restoreFinancialData(user, payload, {
        fullName: typeof fullNameInput === "string" && fullNameInput.trim()
          ? fullNameInput.trim()
          : undefined,
        gender: typeof profileInputs.gender === "string"
          ? profileInputs.gender.trim() || null
          : undefined,
        phone: phoneInput,
        dateOfBirth: typeof dateOfBirthInput === "string" ? dateOfBirthInput : undefined,
        onboardingCompleted: typeof profileInputs.onboardingCompleted === "boolean"
          ? profileInputs.onboardingCompleted
          : undefined,
      }, internalAdmissionLimit(res));
      req.user = {
        ...req.user,
        fullName: restored.user.fullName,
        dateOfBirth: restored.user.dateOfBirth,
        gender: restored.user.gender,
        phone: restored.user.phone,
        onboardingCompleted: restored.user.onboardingCompleted,
      };
      if (restoreUploadCleanup) {
        await completeRestoreUploadCleanup(req.user.id, restoreUploadCleanup);
      }
      await sendFinancialDataStream(res, restored.data);
    } catch (error) {
      if (error instanceof FinancialSaveSizeLimitError) {
        res.status(413).json({
          error: error.message,
          code: error.code,
          limitBytes: error.limitBytes,
        });
        return;
      }
      if (error instanceof FinancialRestoreCollisionError) {
        res.status(409).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof GoalAllocationConflictError) {
        res.status(409).json({
          error: error.message,
          code: error.code,
          allocated: error.allocated,
          available: error.available,
        });
        return;
      }
      throw error;
    }
    return;
  }
  try {
    await sendFinancialDataStream(res, await saveFinancialData(
      user,
      payload,
      undefined,
      "save",
      {
        fullName: typeof fullNameInput === "string" && fullNameInput.trim()
          ? fullNameInput.trim()
          : undefined,
        gender: typeof profileInputs.gender === "string"
          ? profileInputs.gender.trim() || null
          : undefined,
        phone: phoneInput,
        dateOfBirth: typeof dateOfBirthInput === "string" ? dateOfBirthInput : undefined,
        onboardingCompleted: typeof profileInputs.onboardingCompleted === "boolean"
          ? profileInputs.onboardingCompleted
          : undefined,
      },
      internalAdmissionLimit(res),
    ));
  } catch (error) {
    if (error instanceof FinancialSaveSizeLimitError) {
      res.status(413).json({
        error: error.message,
        code: error.code,
        limitBytes: error.limitBytes,
      });
      return;
    }
    if (error instanceof FinancialRestoreCollisionError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof GoalAllocationConflictError) {
      res.status(409).json({
        error: error.message,
        code: error.code,
        allocated: error.allocated,
        available: error.available,
      });
      return;
    }
    throw error;
  }
}

router.put("/financial-data", (req, res) => writeFinancialData(req, res, false));
router.post("/financial-data/restore", (req, res) => writeFinancialData(req, res, true));

router.patch("/financial-data/health", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (
    !isRecord(req.body)
    || (req.body.emergencyFund === undefined && req.body.netWorthSnapshot === undefined)
    || (
      req.body.emergencyFund !== undefined
      && !isValidEmergencyFund(req.body.emergencyFund)
    )
    || (
      req.body.netWorthSnapshot !== undefined
      && !isValidNetWorthSnapshot(req.body.netWorthSnapshot)
    )
  ) {
    res.status(400).json({ error: "Invalid financial health update" });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  await sendFinancialDataStream(res, await updateFinancialHealthPlanning(
    user, req.body, internalAdmissionLimit(res),
  ));
});

router.put("/financial-data/retirement-plan", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!isValidRetirementPlan(req.body)) {
    res.status(400).json({ error: "Invalid retirement plan update" });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  await sendFinancialDataStream(res, await updateRetirementPlanning(
    user, req.body, internalAdmissionLimit(res),
  ));
});

router.patch("/financial-data/planning-categories/:category", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const category = req.params.category?.trim();
  if (!category || category.length > 80 || protectedPlanningCategories.has(category.toLocaleLowerCase())) {
    res.status(400).json({ error: "Only custom planning categories can be managed" });
    return;
  }
  if (
    !isRecord(req.body)
    || !["archive", "rename", "restore"].includes(String(req.body.action))
  ) {
    res.status(400).json({ error: "Choose whether to rename, archive, or restore this category" });
    return;
  }
  const nextCategory = req.body.action === "rename" && typeof req.body.nextCategory === "string"
    ? req.body.nextCategory.trim()
    : undefined;
  if (
    req.body.action === "rename"
    && (
      !nextCategory
      || nextCategory.length > 80
      || protectedPlanningCategories.has(nextCategory.toLocaleLowerCase())
    )
  ) {
    res.status(400).json({ error: "Choose a unique custom category name of up to 80 characters" });
    return;
  }

  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  try {
    await sendFinancialDataStream(res, await managePlanningCategory(
      user,
      category,
      req.body.action as "archive" | "rename" | "restore",
      nextCategory,
      internalAdmissionLimit(res),
    ));
  } catch (error) {
    if (error instanceof PlanningCategoryConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.put("/financial-data/goals", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!isRecord(req.body) || !Array.isArray(req.body.goals)
    || req.body.goals.length > 100 || !req.body.goals.every(isValidGoal)) {
    res.status(400).json({ error: "Invalid goals update" });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  try {
    await sendFinancialDataStream(res, await updatePlanningFeatures(
      user,
      { goals: req.body.goals },
      internalAdmissionLimit(res),
    ));
  } catch (error) {
    if (error instanceof GoalAllocationConflictError) {
      res.status(409).json({
        error: error.message,
        code: error.code,
        allocated: error.allocated,
        available: error.available,
      });
      return;
    }
    throw error;
  }
});

router.put("/financial-data/reminders", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!isRecord(req.body) || !Array.isArray(req.body.reminders)
    || req.body.reminders.length > 500 || !req.body.reminders.every(isValidReminder)) {
    res.status(400).json({ error: "Invalid reminders update" });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  await sendFinancialDataStream(
    res, await updatePlanningFeatures(
      user,
      { customReminders: req.body.reminders },
      internalAdmissionLimit(res),
    ),
  );
});

router.put("/financial-data/notification-preferences", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!isValidNotificationPreferences(req.body)) {
    res.status(400).json({ error: "Invalid notification preferences" });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  await sendFinancialDataStream(
    res, await updatePlanningFeatures(
      user,
      { notificationPreferences: req.body },
      internalAdmissionLimit(res),
    ),
  );
});

// A signed-in account may request an immediate evaluation; the scheduler uses
// the same account-scoped function and there is no cross-account identifier in
// this route.
router.post("/financial-data/planning/evaluate", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  await sendFinancialDataStream(res, await evaluatePlanningForAccount(user));
});

router.get("/financial-data/push-configuration", (req, res): void => {
  if (!requireUser(req, res)) return;
  res.json(getWebPushConfiguration());
});

router.post("/financial-data/notifications", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!isValidNotification(req.body)) {
    res.status(400).json({ error: "Invalid notification" });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  await sendFinancialDataStream(
    res, await updatePlanningFeatures(
      user,
      { notification: req.body },
      internalAdmissionLimit(res),
    ),
  );
});

router.patch("/financial-data/notifications/:id", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id || id.length > 120 || !isRecord(req.body)
    || (req.body.read !== true && req.body.dismissed !== true)
    || Object.keys(req.body).some((key) => key !== "read" && key !== "dismissed")) {
    res.status(400).json({ error: "Invalid notification state update" });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  try {
    await sendFinancialDataStream(res, await updatePlanningFeatures(user, {
      notificationStateUpdate: {
        id,
        read: req.body.read === true,
        dismissed: req.body.dismissed === true,
      },
    }, internalAdmissionLimit(res)));
  } catch (error) {
    if (error instanceof NotificationStateNotFoundError) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    throw error;
  }
});

router.put("/financial-data/push-subscriptions", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!isValidPushSubscription(req.body)) {
    res.status(400).json({ error: "Invalid push subscription" });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  await sendFinancialDataStream(
    res, await updatePlanningFeatures(
      user,
      { pushSubscription: req.body },
      internalAdmissionLimit(res),
    ),
  );
});

router.delete("/financial-data/push-subscriptions", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!isRecord(req.body) || typeof req.body.endpoint !== "string"
    || !isSupportedPushEndpoint(req.body.endpoint)) {
    res.status(400).json({ error: "Invalid push subscription endpoint" });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  await sendFinancialDataStream(
    res, await updatePlanningFeatures(
      user,
      { removePushEndpoint: req.body.endpoint },
      internalAdmissionLimit(res),
    ),
  );
});

router.post("/financial-data/monthly-reports", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!isValidMonthlyReport(req.body)) {
    res.status(400).json({ error: "Invalid monthly report snapshot" });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const { retirementForecast: _serverOwnedForecast, ...clientReport } = req.body as Record<string, unknown>;
  await sendFinancialDataStream(res, await updatePlanningFeatures(
    user,
    { monthlyReportSnapshot: { ...clientReport, generatedAt: new Date().toISOString() } },
    internalAdmissionLimit(res),
  ));
});

router.post("/financial-data/monthly-reports/:id/email", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id || id.length > 120) {
    res.status(400).json({ error: "Invalid monthly report" });
    return;
  }
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const financialData = await loadFinancialData(user);
  const report = financialData.monthlyReports?.find((item) => item.id === id);
  if (!report) {
    res.status(404).json({ error: "Monthly report not found" });
    return;
  }
  if (!user.email) {
    res.status(400).json({ error: "Your account does not have an email address" });
    return;
  }
  const deliveryState = financialData.monthlyReportEmailFailures[report.month]
    ? await updatePlanningFeatures(user, {
        monthlyReportEmailClearFailureMonth: report.month,
      })
    : financialData;
  try {
    await sendMonthlyReportEmail(user.email, report);
  } catch (error) {
    await updatePlanningFeatures(user, {
      monthlyReportEmailFailure: {
        month: report.month,
        category: classifyMonthlyReportDeliveryFailure(error),
      },
    });
    res.status(503).json({ error: "Monthly report email is temporarily unavailable" });
    return;
  }
  try {
    const delivered = await monthlyReportDeliveryMarker(user, report.month);
    await sendFinancialDataStream(res, delivered);
  } catch {
    await sendFinancialDataStream(res, {
      ...deliveryState,
      monthlyReportEmailStatusPendingMonths: [report.month],
    });
  }
});

router.delete("/financial-data", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  await sendFinancialDataStream(res, await clearFinancialData(user));
});

router.delete("/financial-data/expenses/:id", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const user = await loadUser(req.user.id);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const result = await deleteFinancialExpense(user, req.params.id);
  if (!result) res.status(404).json({ error: "Expense not found" });
  else await sendFinancialDataStream(res, result);
});

export default router;
