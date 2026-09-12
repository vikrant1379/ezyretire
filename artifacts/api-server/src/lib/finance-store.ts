import {
  budgetsTable,
  db,
  expensesTable,
  bankStatementImportProvenanceTable,
  incomeReceiptsTable,
  incomeSourcesTable,
  investmentsTable,
  loansTable,
  mobileOtpChallengesTable,
  receiptReviewsTable,
  retirementPlansTable,
  salaryDetailsTable,
  type StoredBudgetSchedule,
  type StoredPlanningData,
  userProfilesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import crypto from "crypto";
import { FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT } from "./request-limits.js";

export type FinancialDataResponse = {
  expenses: unknown[];
  budgets: unknown[];
  incomeSources: unknown[];
  incomeReceipts: unknown[];
  investments: unknown[];
  loans: unknown[];
  plannedExpenses: unknown[];
  netWorthSnapshots: unknown[];
  emergencyFund: {
    targetMonths: number;
    reserveBalance: number;
    monthlyContribution: number;
  };
  goals: StoredPlanningData["goals"];
  reminders: StoredPlanningData["customReminders"];
  notificationPreferences: NonNullable<StoredPlanningData["notificationPreferences"]>;
  notifications: StoredPlanningData["notificationState"];
  pushSubscriptions: Array<Omit<NonNullable<StoredPlanningData["pushSubscriptions"]>[number], "p256dh" | "auth">>;
  monthlyReports: StoredPlanningData["monthlyReportSnapshots"];
  monthlyReportEmailFailures: Record<string, {
    category: "report_too_large" | "email_unavailable" | "temporary";
    failedAt: string;
  }>;
  retirementInputs: {
    dateOfBirth: string;
    targetRetirementAge: number;
    lifeExpectancy: number;
    generalInflation: number;
    salaryGrowth: number;
    monthlyContributionOverride?: number;
    investSurplus: boolean;
    lifestyleChoice?: "Basic" | "Comfortable" | "Premium" | "Custom";
    customLifestyleExpense?: number;
    retirementSpendingAdjustmentPercent?: number;
    pensionSources: unknown[];
  };
  profileInputs: {
    fullName?: string;
    gender?: string;
    email?: string;
    phone?: string;
    onboardingCompleted?: boolean;
    onboardingProgress?: {
      currentStep: number;
      completedSteps: number[];
      skippedSteps: number[];
      firstProjectionSaved?: boolean;
      dismissed?: boolean;
      rerunInProgress?: boolean;
    };
    dateOfBirth: string;
    targetRetirementAge: number;
    lifeExpectancy: number;
    riskPreference: string;
  };
  uiPreferences: {
    investmentOrder: string[];
    loanOrder: string[];
    incomeOrder: string[];
    archivedPlanningCategories: string[];
    investmentSort: { by: string; direction: string };
    loanSort: { by: string; direction: string };
    incomeSort: { by: string; direction: string };
    dashboardTourDismissed: boolean;
  };
};

export type BankStatementImportRow = {
  importId: string;
  sourceRowId: string;
  bank: string;
  parserVersion: string;
  date: string;
  amount: number;
  category: string;
  merchant: string;
  paymentMethod: string;
  note?: string;
  reimbursable?: boolean;
  recurring?: boolean;
};

export const FINANCIAL_SAVE_SIZE_LIMIT_CODE = "FINANCIAL_SAVE_SIZE_LIMIT";

export class FinancialSaveSizeLimitError extends Error {
  readonly code = FINANCIAL_SAVE_SIZE_LIMIT_CODE;
  readonly status = 413;

  constructor(
    readonly actualBytes: number,
    readonly limitBytes: number,
  ) {
    super("This change would make your financial data too large to save. Remove older expenses or reduce the change and try again.");
    this.name = "FinancialSaveSizeLimitError";
  }
}

const BULK_INSERT_ROW_CHUNK_SIZE = 500;

function rowChunks<Row>(rows: Row[]): Row[][] {
  const chunks: Row[][] = [];
  for (let offset = 0; offset < rows.length; offset += BULK_INSERT_ROW_CHUNK_SIZE) {
    chunks.push(rows.slice(offset, offset + BULK_INSERT_ROW_CHUNK_SIZE));
  }
  return chunks;
}

/**
 * Conservative upper projection for saveFinancialDataForGeneration in the web
 * client. Monthly reports are the only intentionally omitted section. It keeps
 * every other server section and also materializes the client's optional
 * contribution default, so it is never a few bytes smaller than either the
 * immediate post-mutation document or the normalized post-reload document.
 */
export function financialSaveMutationDocument(data: FinancialDataResponse) {
  const { monthlyReports: _monthlyReports, ...transportDocument } = data;
  return {
    ...transportDocument,
    retirementInputs: {
      ...transportDocument.retirementInputs,
      monthlyContributionOverride:
        transportDocument.retirementInputs.monthlyContributionOverride ?? 0,
    },
  };
}

export async function importBankStatementExpenses(
  user: typeof usersTable.$inferSelect,
  incoming: BankStatementImportRow[],
  financialDocumentAdmissionLimit = FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT,
): Promise<{ added: unknown[]; duplicateCount: number; data: FinancialDataResponse }> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${financialLifecycleLockKey(user.id)}))`);
    const admissionBaseline = await captureCanonicalAdmissionBaseline(tx, user);
    const provenance = await tx.select({
      importId: bankStatementImportProvenanceTable.importId,
      sourceRowId: bankStatementImportProvenanceTable.sourceRowId,
    }).from(bankStatementImportProvenanceTable)
      .where(eq(bankStatementImportProvenanceTable.userId, user.id));
    const keys = new Set(provenance.map((row) => `${row.importId}|${row.sourceRowId}`));
    const seen = new Set<string>();
    const added: typeof expensesTable.$inferSelect[] = [];
    const additions: Array<{
      expense: typeof expensesTable.$inferSelect;
      source: BankStatementImportRow;
    }> = [];
    let duplicateCount = 0;
    for (const row of incoming) {
      const key = `${row.importId}|${row.sourceRowId}`;
      if (keys.has(key) || seen.has(key)) {
        duplicateCount++;
        continue;
      }
      seen.add(key);
      const inserted = {
        id: crypto.randomUUID(),
        userId: user.id,
        loanId: null,
        date: row.date.slice(0, 10),
        amount: row.amount.toFixed(2),
        category: row.category.trim(),
        merchant: row.merchant.trim(),
        paymentMethod: row.paymentMethod.trim(),
        note: row.note?.trim() ?? "",
        reimbursable: row.reimbursable === true,
        recurring: row.recurring === true,
        createdAt: new Date(),
      };
      const expense = inserted as typeof expensesTable.$inferSelect;
      added.push(expense);
      additions.push({ expense, source: row });
    }
    const profile = await tx.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, user.id)).limit(1);
    const plan = await tx.select().from(retirementPlansTable)
      .where(eq(retirementPlansTable.userId, user.id)).limit(1);
    const expenses = await tx.select().from(expensesTable)
      .where(eq(expensesTable.userId, user.id));
    const budgets = await tx.select().from(budgetsTable)
      .where(eq(budgetsTable.userId, user.id));
    const incomeSources = await tx.select().from(incomeSourcesTable)
      .where(eq(incomeSourcesTable.userId, user.id));
    const incomeReceipts = await tx.select().from(incomeReceiptsTable)
      .where(eq(incomeReceiptsTable.userId, user.id));
    const investments = await tx.select().from(investmentsTable)
      .where(eq(investmentsTable.userId, user.id));
    const loans = await tx.select().from(loansTable)
      .where(eq(loansTable.userId, user.id));
    const salary = incomeSources.length === 0
      ? []
      : await tx.select().from(salaryDetailsTable).where(inArray(
        salaryDetailsTable.incomeSourceId,
        incomeSources.map((source) => source.id),
      ));
    const data = buildFinancialData(user, {
      profile: profile[0],
      plan: plan[0],
      expenses: [...expenses, ...added],
      budgets,
      incomeSources,
      incomeReceipts,
      salary,
      investments,
      loans,
    });
    for (const chunk of rowChunks(additions.map(({ expense }) => expense))) {
      await tx.insert(expensesTable).values(chunk);
    }
    const provenanceRows = additions.map(({ expense, source }) => ({
        userId: user.id,
        importId: source.importId,
        sourceRowId: source.sourceRowId,
        bank: source.bank,
        parserVersion: source.parserVersion,
        expenseId: expense.id,
    }));
    for (const chunk of rowChunks(provenanceRows)) {
      await tx.insert(bankStatementImportProvenanceTable).values(chunk);
    }
    await assertCanonicalMutationAdmission(
      tx,
      user,
      admissionBaseline,
      financialDocumentAdmissionLimit,
    );
    return { added, duplicateCount, data };
  });
  return result;
}

export class FinancialRestoreCollisionError extends Error {
  readonly code = "FINANCIAL_RESTORE_ID_COLLISION";

  constructor() {
    super("One or more backup expense IDs are unavailable for this account");
    this.name = "FinancialRestoreCollisionError";
  }
}

export type FinancialRestoreAccountMutation = {
  fullName?: string;
  gender?: string | null;
  phone?: string | null;
  dateOfBirth?: string;
  onboardingCompleted?: boolean;
};

export function financialLifecycleLockKey(userId: string): string {
  return `financial-lifecycle:${userId}`;
}

type PlanningDataWithReportDelivery = StoredPlanningData & {
  monthlyReportEmailDeliveries?: Record<string, string>;
};

export type MonthlyReportEmailFailureCategory =
  "report_too_large" | "email_unavailable" | "temporary";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

function asOptionalNonNegativeNumber(value: unknown): number | undefined {
  const numericValue = asOptionalNumber(value);
  return numericValue !== undefined && numericValue >= 0 ? numericValue : undefined;
}

function fundAllocations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((allocation) => {
    const amount = asNumber(allocation.amount);
    const sourceId = asString(allocation.sourceId).trim();
    const opportunityDate = normalizeDateOnly(allocation.opportunityDate);
    const investmentDate = normalizeDateOnly(allocation.investmentDate);
    if (amount <= 0 || !sourceId || !opportunityDate || !investmentDate) return [];
    return [{
      id: rowId(allocation.id),
      sourceId,
      opportunityDate,
      investmentDate,
      amount,
      createdAt: asString(allocation.createdAt) || new Date().toISOString(),
    }];
  });
}

function investmentDisposals(value: unknown, investmentId: string) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((disposal, index) => {
    const id = asString(disposal.id).trim() || `${investmentId}-disposal-${index + 1}`;
    const name = asString(disposal.name).trim() || `Disposal ${index + 1}`;
    return omitEmpty({
      id,
      name,
      purchaseDate: calendarDate(disposal.purchaseDate) ?? undefined,
      saleDate: calendarDate(disposal.saleDate) ?? undefined,
      costBasis: asOptionalNonNegativeNumber(disposal.costBasis),
      proceeds: asOptionalNonNegativeNumber(disposal.proceeds),
      assetType: asString(disposal.assetType).trim() || undefined,
      eligibleExemption: asOptionalNonNegativeNumber(disposal.eligibleExemption),
      indexedCostBasis: asOptionalNonNegativeNumber(disposal.indexedCostBasis),
      grandfatheredValue: asOptionalNonNegativeNumber(disposal.grandfatheredValue),
    });
  });
}

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function onboardingProgress(value: unknown) {
  if (!isRecord(value)) return undefined;
  const stepList = (item: unknown) => Array.isArray(item)
    ? [...new Set(item.map(Number).filter((step) => Number.isInteger(step) && step >= 1 && step <= 8))]
    : [];
  return {
    currentStep: Math.max(1, Math.min(8, Math.round(asNumber(value.currentStep, 1)))),
    completedSteps: stepList(value.completedSteps),
    skippedSteps: stepList(value.skippedSteps),
    firstProjectionSaved: asBoolean(value.firstProjectionSaved),
    dismissed: asBoolean(value.dismissed),
    rerunInProgress: asBoolean(value.rerunInProgress),
  };
}

function plannedExpenses(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((expense) => {
    const name = asString(expense.name).trim();
    const expectedDate = calendarDate(expense.expectedDate);
    const amount = Math.max(0, asNumber(expense.amount));
    if (!name || !expectedDate || amount <= 0) return [];
    return [omitEmpty({
      id: rowId(expense.id),
      name,
      category: asString(expense.category, "Other") || "Other",
      amount,
      expectedDate,
      customInflationRate: asOptionalNonNegativeNumber(expense.customInflationRate),
      createdAt: asString(expense.createdAt) || new Date().toISOString(),
    })];
  });
}

function normalizeNetWorthSnapshots(value: unknown) {
  if (!Array.isArray(value)) return [];
  const byMonth = new Map<string, {
    month: string;
    assets: number;
    liabilities: number;
    netWorth: number;
    healthScore?: number;
  }>();
  value.filter(isRecord).forEach((snapshot) => {
    const month = normalizeMonth(snapshot.month);
    const assets = asOptionalNonNegativeNumber(snapshot.assets);
    const liabilities = asOptionalNonNegativeNumber(snapshot.liabilities);
    if (!month || assets === undefined || liabilities === undefined) return;
    byMonth.set(month, {
      month,
      assets,
      liabilities,
      netWorth: assets - liabilities,
      ...(asOptionalNonNegativeNumber(snapshot.healthScore) !== undefined
        ? { healthScore: Math.min(100, asOptionalNonNegativeNumber(snapshot.healthScore)!) }
        : {}),
    });
  });
  return [...byMonth.values()].sort((left, right) => left.month.localeCompare(right.month));
}

function normalizeEmergencyFund(value: unknown, legacy: Record<string, unknown> = {}) {
  const record = isRecord(value) ? value : {};
  return {
    targetMonths: asOptionalNonNegativeNumber(record.targetMonths ?? legacy.emergencyTargetMonths) ?? 6,
    reserveBalance: asOptionalNonNegativeNumber(record.reserveBalance ?? legacy.emergencyReserveBalance) ?? 0,
    monthlyContribution:
      asOptionalNonNegativeNumber(record.monthlyContribution ?? legacy.emergencyMonthlyContribution) ?? 0,
  };
}

const notificationTypes = new Set([
  "budget", "retirement", "goal", "upcoming", "milestone", "tax", "anomaly",
]);

function timestamp(value: unknown, fallback = new Date().toISOString()): string {
  if (typeof value !== "string") return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function normalizeGoals(value: unknown): NonNullable<StoredPlanningData["goals"]> {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, NonNullable<StoredPlanningData["goals"]>[number]>();
  value.filter(isRecord).forEach((goal, index) => {
    const id = asString(goal.id).trim();
    const name = asString(goal.name).trim();
    const targetDate = normalizeDateOnly(goal.targetDate);
    if (!id || !name || !targetDate || name.length > 160) return;
    const createdAt = timestamp(goal.createdAt);
    byId.set(id, {
      id,
      name,
      targetAmount: Math.max(0, asNumber(goal.targetAmount)),
      currentAmount: Math.max(0, asNumber(goal.currentAmount)),
      targetDate,
      priority: Math.max(1, Math.min(1000, Math.round(asNumber(goal.priority, index + 1)))),
      monthlyAllocation: Math.max(0, asNumber(goal.monthlyAllocation)),
      annualInflationRate: Math.max(
        0,
        Math.min(25, asNumber(goal.annualInflationRate ?? goal.inflationRate)),
      ),
      createdAt,
    });
  });
  return [...byId.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function normalizeReminders(value: unknown): NonNullable<StoredPlanningData["customReminders"]> {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, NonNullable<StoredPlanningData["customReminders"]>[number]>();
  value.filter(isRecord).forEach((reminder) => {
    const id = asString(reminder.id).trim();
    const title = asString(reminder.title).trim();
    const date = normalizeDateOnly(reminder.date ?? reminder.dueDate);
    if (!id || !title || title.length > 160 || !date) return;
    const recurrence = reminder.recurrence === "monthly" || reminder.recurrence === "yearly"
      ? reminder.recurrence
      : "none";
    const createdAt = timestamp(reminder.createdAt);
    const amount = asOptionalNonNegativeNumber(reminder.amount);
    byId.set(id, omitEmpty({
      id,
      title,
      date,
      amount,
      notes: asString(reminder.notes).trim().slice(0, 1000) || undefined,
      recurrence,
      enabled: reminder.enabled !== false && reminder.completed !== true,
      createdAt,
    }));
  });
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function normalizeNotificationPreferences(
  value: unknown,
): NonNullable<StoredPlanningData["notificationPreferences"]> {
  const record = isRecord(value) ? value : {};
  const types = isRecord(record.types) ? record.types : {};
  const quiet = isRecord(record.quietHours) ? record.quietHours : {};
  const time = (item: unknown, fallback: string) =>
    typeof item === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(item) ? item : fallback;
  let timeZone = asString(record.timeZone, "Asia/Kolkata").trim() || "Asia/Kolkata";
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch {
    timeZone = "UTC";
  }
  return {
    enabled: asBoolean(record.enabled, true),
    inApp: asBoolean(record.inApp, true),
    push: asBoolean(record.push),
    types: Object.fromEntries([...notificationTypes].map((type) => [type, asBoolean(types[type], true)])),
    quietHours: {
      start: time(quiet.start, "22:00"),
      end: time(quiet.end, "07:00"),
    },
    weeklyDigest: asBoolean(record.weeklyDigest),
    monthlyReportEmail: asBoolean(record.monthlyReportEmail),
    digestDay: Math.max(0, Math.min(6, Math.round(asNumber(record.digestDay, 1)))),
    timeZone,
  };
}

function normalizeNotificationState(value: unknown): NonNullable<StoredPlanningData["notificationState"]> {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, NonNullable<StoredPlanningData["notificationState"]>[number]>();
  value.filter(isRecord).forEach((item) => {
    const id = asString(item.id).trim();
    const dedupeKey = asString(item.dedupeKey ?? item.eventKey).trim();
    const type = asString(item.type).trim();
    const title = asString(item.title).trim();
    const message = asString(item.message).trim();
    if (!id || !dedupeKey || !notificationTypes.has(type) || !title || !message) return;
    const createdAt = timestamp(item.createdAt);
    byKey.set(dedupeKey, omitEmpty({
      id, dedupeKey, type, title: title.slice(0, 160), message: message.slice(0, 1000),
      createdAt,
      deliverAfter: timestamp(item.deliverAfter, createdAt),
      channels: Array.isArray(item.channels)
        ? item.channels.filter((channel) => channel === "in-app" || channel === "push")
        : ["in-app"],
      readAt: item.readAt ? timestamp(item.readAt) : undefined,
      dismissedAt: item.dismissedAt ? timestamp(item.dismissedAt) : undefined,
      inAppDeliveredAt: item.inAppDeliveredAt ? timestamp(item.inAppDeliveredAt) : undefined,
      pushDeliveredAt: item.pushDeliveredAt ? timestamp(item.pushDeliveredAt) : undefined,
      emailDeliveredAt: item.emailDeliveredAt ? timestamp(item.emailDeliveredAt) : undefined,
    }));
  });
  return [...byKey.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
}

function mergeNotificationState(
  current: unknown,
  incoming: unknown,
): NonNullable<StoredPlanningData["notificationState"]> {
  const existing = normalizeNotificationState(current);
  const existingByKey = new Map(existing.map((item) => [item.dedupeKey, item]));
  const incomingItems = normalizeNotificationState(incoming);
  const incomingKeys = new Set(incomingItems.map((item) => item.dedupeKey));
  return normalizeNotificationState([
    ...incomingItems.map((item) => {
    const existing = existingByKey.get(item.dedupeKey);
    return {
      ...item,
      readAt: existing?.readAt ?? item.readAt,
      dismissedAt: existing?.dismissedAt ?? item.dismissedAt,
      inAppDeliveredAt: existing?.inAppDeliveredAt ?? item.inAppDeliveredAt,
      pushDeliveredAt: existing?.pushDeliveredAt ?? item.pushDeliveredAt,
      emailDeliveredAt: existing?.emailDeliveredAt ?? item.emailDeliveredAt,
    };
    }),
    ...existing.filter((item) => !incomingKeys.has(item.dedupeKey)),
  ]);
}

export function isSupportedPushEndpoint(endpointValue: unknown): boolean {
  if (typeof endpointValue !== "string" || endpointValue.length > 2048) return false;
  try {
    const url = new URL(endpointValue);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return host === "fcm.googleapis.com"
      || host === "updates.push.services.mozilla.com"
      || host === "push.services.mozilla.com"
      || host === "web.push.apple.com"
      || host.endsWith(".push.apple.com")
      || host.endsWith(".notify.windows.com");
  } catch {
    return false;
  }
}

function normalizePushSubscriptions(value: unknown): NonNullable<StoredPlanningData["pushSubscriptions"]> {
  if (!Array.isArray(value)) return [];
  const byEndpoint = new Map<string, NonNullable<StoredPlanningData["pushSubscriptions"]>[number]>();
  value.filter(isRecord).forEach((item) => {
    const endpoint = asString(item.endpoint).trim();
    const p256dh = asString(item.p256dh).trim();
    const auth = asString(item.auth).trim();
    if (!isSupportedPushEndpoint(endpoint) || !p256dh || !auth) return;
    const createdAt = timestamp(item.createdAt);
    byEndpoint.set(endpoint, omitEmpty({
      endpoint, p256dh, auth,
      expirationTime: asOptionalNonNegativeNumber(item.expirationTime),
      createdAt, updatedAt: timestamp(item.updatedAt, createdAt),
    }));
  });
  return [...byEndpoint.values()];
}

function normalizeMonthlyReports(value: unknown): NonNullable<StoredPlanningData["monthlyReportSnapshots"]> {
  if (!Array.isArray(value)) return [];
  const sectionIds = new Set([
    "income-vs-expected",
    "expenses-vs-budget-category",
    "savings-amount-rate",
    "portfolio-value-returns-change",
    "net-worth-change",
    "retirement-date-movement",
    "health-score-change",
    "top-next-month-actions",
  ]);
  const byMonth = new Map<string, NonNullable<StoredPlanningData["monthlyReportSnapshots"]>[number]>();
  value.filter(isRecord).forEach((report) => {
    const month = normalizeMonth(report.month);
    if (!month || !Array.isArray(report.sections)) return;
    const sections = report.sections.filter(isRecord).flatMap((section) => {
      const id = asString(section.id);
      if (!sectionIds.has(id) || !isRecord(section.metrics)
        || !isRecord(section.metricFormats) || !Array.isArray(section.actions)) return [];
      const metrics = Object.fromEntries(Object.entries(section.metrics).flatMap(([key, metric]) => {
        const value = asOptionalNumber(metric);
        return value === undefined ? [] : [[key.slice(0, 120), value]];
      }));
      const rawMetricFormats = section.metricFormats as Record<string, unknown>;
      const metricFormats = Object.fromEntries(Object.keys(metrics).map((key) => {
        const rawFormat = asString(rawMetricFormats[key]);
        const format = ["currency", "percent", "count", "number"].includes(rawFormat)
          ? rawFormat
          : "number";
        return [key, format];
      }));
      const unavailableMetrics = Array.isArray(section.unavailableMetrics)
        ? [...new Set(section.unavailableMetrics
            .filter((metric): metric is string => typeof metric === "string" && !(metric in metrics))
            .map((metric) => metric.slice(0, 120)))]
        : [];
      return [{
        id,
        title: asString(section.title).slice(0, 160),
        metrics,
        metricFormats,
        ...(unavailableMetrics.length > 0 ? { unavailableMetrics } : {}),
        actions: section.actions
          .filter((action): action is string => typeof action === "string")
          .map((action) => action.slice(0, 500)),
      }];
    });
    if (sections.length !== 8 || new Set(sections.map((section) => section.id)).size !== 8) return;
    const rawForecast = isRecord(report.retirementForecast) ? report.retirementForecast : undefined;
    const rawAssumptions = rawForecast && isRecord(rawForecast.assumptions)
      ? rawForecast.assumptions
      : undefined;
    const retirementForecast = rawForecast && rawAssumptions
      && /^\d{4}-\d{2}-\d{2}$/.test(asString(rawForecast.asOfDate))
      ? {
          projectedRetirementMonth: rawForecast.projectedRetirementMonth === null
            ? null
            : normalizeMonth(rawForecast.projectedRetirementMonth) ?? null,
          projectedRetirementAge: rawForecast.projectedRetirementAge === null
            ? null
            : asOptionalNumber(rawForecast.projectedRetirementAge) ?? null,
          asOfDate: asString(rawForecast.asOfDate),
          modelVersion: asOptionalNumber(rawForecast.modelVersion),
          assumptions: {
            targetRetirementAge: asNumber(rawAssumptions.targetRetirementAge),
            lifeExpectancy: asNumber(rawAssumptions.lifeExpectancy),
            generalInflation: asNumber(rawAssumptions.generalInflation),
            salaryGrowth: asNumber(rawAssumptions.salaryGrowth),
            monthlyContribution: asNumber(rawAssumptions.monthlyContribution),
            monthlySpending: asNumber(rawAssumptions.monthlySpending),
            portfolioValue: asNumber(rawAssumptions.portfolioValue),
            investedPrincipal: asOptionalNumber(rawAssumptions.investedPrincipal),
            portfolioReturnAmount: asOptionalNumber(rawAssumptions.portfolioReturnAmount),
            expectedReturn: asNumber(rawAssumptions.expectedReturn),
          },
          ...(isRecord(rawForecast.projectionInputs) ? {
            projectionInputs: {
              expenses: asArray(rawForecast.projectionInputs.expenses).filter(isRecord),
              budgets: asArray(rawForecast.projectionInputs.budgets).filter(isRecord),
              incomes: asArray(rawForecast.projectionInputs.incomes).filter(isRecord),
              investments: asArray(rawForecast.projectionInputs.investments).filter(isRecord),
              loans: asArray(rawForecast.projectionInputs.loans).filter(isRecord),
              plannedExpenses: asArray(rawForecast.projectionInputs.plannedExpenses).filter(isRecord),
              emergencyFund: isRecord(rawForecast.projectionInputs.emergencyFund)
                ? rawForecast.projectionInputs.emergencyFund
                : {},
              assumptions: isRecord(rawForecast.projectionInputs.assumptions)
                ? rawForecast.projectionInputs.assumptions
                : {},
            },
          } : {}),
          drivers: asArray(rawForecast.drivers)
            .filter((driver): driver is string => typeof driver === "string")
            .slice(0, 4)
            .map((driver) => driver.slice(0, 500)),
        }
      : undefined;
    byMonth.set(month, {
      id: asString(report.id).trim() || `monthly-report-${month}`,
      month,
      generatedAt: timestamp(report.generatedAt),
      ...(retirementForecast ? { retirementForecast } : {}),
      sections,
    });
  });
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 120);
}

function normalizeLifestyle(value: unknown) {
  return value === "Basic" || value === "Comfortable" || value === "Premium" || value === "Custom"
    ? value
    : undefined;
}

function normalizePensionSources(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((source, index) => {
    const name = asString(source.name).trim();
    const monthlyAmount = asOptionalNonNegativeNumber(source.monthlyAmount ?? source.amount);
    if (!name || monthlyAmount === undefined) return [];
    const startAge = asOptionalNonNegativeNumber(source.startAge);
    return [omitEmpty({
      id: asString(source.id).trim() || `pension-${index + 1}`,
      name,
      monthlyAmount,
      startAge: startAge === undefined ? undefined : Math.round(startAge),
      annualEscalationRate:
        asOptionalNonNegativeNumber(source.annualEscalationRate ?? source.escalationRate) ?? 0,
    })];
  });
}

const investmentSortKeys = new Set(["manual", "invested", "current", "gain", "projected"]);
const loanSortKeys = new Set(["manual", "outstanding", "emi", "remaining", "interest"]);
const incomeSortKeys = new Set(["manual", "monthly", "annual", "growth"]);

function asSortChoice(
  value: unknown,
  allowed: Set<string>,
): { by: string; direction: string } {
  const record = isRecord(value) ? value : {};
  const by = typeof record.by === "string" && allowed.has(record.by) ? record.by : "manual";
  const direction = record.direction === "asc" ? "asc" : "desc";
  return { by, direction };
}

export function normalizeUiPreferences(value: unknown): FinancialDataResponse["uiPreferences"] {
  const record = isRecord(value) ? value : {};
  return {
    investmentOrder: asIdList(record.investmentOrder),
    loanOrder: asIdList(record.loanOrder),
    incomeOrder: asIdList(record.incomeOrder),
    archivedPlanningCategories: asIdList(record.archivedPlanningCategories),
    investmentSort: asSortChoice(record.investmentSort, investmentSortKeys),
    loanSort: asSortChoice(record.loanSort, loanSortKeys),
    incomeSort: asSortChoice(record.incomeSort, incomeSortKeys),
    dashboardTourDismissed: asBoolean(record.dashboardTourDismissed),
  };
}

function money(value: unknown, fallback = 0): string {
  return String(asNumber(value, fallback));
}

function optionalMoney(value: unknown): string | null {
  const numericValue = asOptionalNumber(value);
  return numericValue === undefined ? null : String(numericValue);
}

function rowId(value: unknown): string {
  const id = asString(value).trim();
  return id || crypto.randomUUID();
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultDateOfBirth(): string {
  return formatDateOnly(new Date(Date.now() - 86400000 * 365 * 30));
}

function normalizeDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? value.trim()
    : null;
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const prefix = value.trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return prefix ? normalizeDateOnly(prefix) : null;
}

function annualOccurrence(anchorValue: unknown, opportunityValue: unknown) {
  const anchor = calendarDate(anchorValue);
  const opportunity = calendarDate(opportunityValue);
  if (!anchor || !opportunity || opportunity < anchor) return false;
  const [anchorYear, anchorMonth, anchorDay] = anchor.split("-").map(Number);
  const [year] = opportunity.split("-").map(Number);
  const lastDay = new Date(year, anchorMonth, 0).getDate();
  const expected = `${year}-${String(anchorMonth).padStart(2, "0")}-${String(Math.min(anchorDay, lastDay)).padStart(2, "0")}`;
  return year >= anchorYear && opportunity === expected;
}

function incomeEndSchedule(mode: unknown, dateValue: unknown, recurring = true, frequency = "Monthly") {
  const date = normalizeDateOnly(dateValue);
  return recurring && frequency !== "One-time" && mode === "custom" && date
    ? { incomeEndMode: "custom" as const, incomeEndDate: date }
    : { incomeEndMode: "retirement" as const, incomeEndDate: null };
}

function normalizedIncomeFrequency(frequencyValue: unknown, recurringValue: unknown) {
  const rawFrequency = asString(frequencyValue, "Monthly");
  const frequency = rawFrequency === "Annual" || rawFrequency === "One-time"
    ? rawFrequency
    : "Monthly";
  // Legacy Annual + non-recurring was the old representation of a one-off.
  return frequency === "Annual" && recurringValue === false ? "One-time" : frequency;
}

function isLegacyAnnualSalary(
  type: unknown,
  frequency: unknown,
  recurring: unknown,
  salaryDetails: unknown,
) {
  return type === "Salary"
    && frequency === "Annual"
    && recurring === true
    && isRecord(salaryDetails);
}

function monthlySalaryDetails(details: Record<string, unknown>): Record<string, unknown> {
  return {
    ...details,
    basicPay: asNumber(details.basicPay) / 12,
    hra: asNumber(details.hra) / 12,
    allowances: asNumber(details.allowances) / 12,
    employeePF: asNumber(details.employeePF) / 12,
    professionalTax: asNumber(details.professionalTax) / 12,
    tds: asNumber(details.tds) / 12,
    otherDeductions: asNumber(details.otherDeductions) / 12,
  };
}

function salaryMode(value: unknown): "automatic" | "manual" {
  return value === "automatic" ? "automatic" : "manual";
}

function normalizedSalaryDetails(details: Record<string, unknown>) {
  const taxRegime = details.taxRegime === "new" || details.taxRegime === "old"
    ? details.taxRegime
    : undefined;
  return omitEmpty({
    grossCTC: asNumber(details.grossCTC),
    grossCTCMode: salaryMode(details.grossCTCMode),
    basicPay: asNumber(details.basicPay),
    hra: asNumber(details.hra),
    allowances: asNumber(details.allowances),
    employeePF: asNumber(details.employeePF),
    professionalTax: asNumber(details.professionalTax),
    tds: asNumber(details.tds),
    tdsMode: salaryMode(details.tdsMode),
    taxRegime,
    financialYear: asString(details.financialYear) || undefined,
    taxRuleVersion: asString(details.taxRuleVersion) || undefined,
    otherDeductions: asNumber(details.otherDeductions),
  });
}

function omitEmpty<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""),
  ) as T;
}

/**
 * The row shapes the response is built from. They are the columns the document
 * exposes, so both freshly written rows and rows read back from the database
 * satisfy them.
 */
type InvestmentRow = Omit<
  typeof investmentsTable.$inferSelect,
  "userId" | "accountId" | "updatedAt"
>;
type IncomeRow = Omit<typeof incomeSourcesTable.$inferSelect, "userId" | "accountId" | "updatedAt">;
type IncomeReceiptRow = Omit<typeof incomeReceiptsTable.$inferSelect, "userId" | "updatedAt">;
type SalaryRow = typeof salaryDetailsTable.$inferSelect;
type ExpenseRow = Omit<typeof expensesTable.$inferSelect, "userId" | "accountId" | "updatedAt">;
type BudgetRow = Pick<typeof budgetsTable.$inferSelect, "id" | "category" | "monthlyLimit" | "details">;
type LoanRow = Omit<typeof loansTable.$inferSelect, "userId" | "accountId" | "updatedAt">;

function investmentFromRow(row: InvestmentRow) {
  const details = isRecord(row.details) ? row.details : {};
  return omitEmpty({
    id: row.id,
    name: row.name,
    assetClass: row.assetClass,
    investedAmount: asNumber(row.investedAmount),
    currentValue: asNumber(row.currentValue),
    quantity: asOptionalNumber(row.quantity),
    averageBuyPrice: asOptionalNumber(row.averageBuyPrice),
    monthlyContribution: asOptionalNumber(row.monthlyContribution),
    contributionStartDate: row.contributionStartDate,
    contributionEndMode: row.contributionEndMode === "custom" ? "custom" : "retirement",
    contributionEndDate: row.contributionEndDate ?? undefined,
    linkedIncomeSourceId: row.linkedIncomeSourceId ?? undefined,
    autoManagedContribution: row.autoManagedContribution,
    expectedReturn: asNumber(row.expectedReturn),
    ticker: row.ticker ?? undefined,
    folio: row.folio ?? undefined,
    institution: row.institution ?? undefined,
    interestRate: asOptionalNumber(row.interestRate),
    accountNumber: row.accountNumber ?? undefined,
    unit: typeof details.unit === "string" ? details.unit : undefined,
    location: typeof details.location === "string" ? details.location : undefined,
    area: typeof details.area === "string" ? details.area : undefined,
    fundAllocations: fundAllocations(details.fundAllocations),
    disposals: investmentDisposals(details.disposals, row.id),
    maturityDate: row.maturityDate ?? undefined,
    notes: row.notes || undefined,
    createdAt: row.createdAt.toISOString(),
  });
}

const legacyBudgetStartMonth = "1900-01";

function normalizeMonth(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const month = value.trim();
  const match = month.match(/^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/);
  return match ? `${match[1]}-${match[2]}` : undefined;
}

function budgetSchedules(value: unknown): StoredBudgetSchedule[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((schedule) => {
    // startDate/monthlyLimit/endDate are accepted for compatibility with the
    // first budget-window client. Storage itself uses month-granularity.
    const windowShape = "startDate" in schedule || "monthlyLimit" in schedule;
    const startMonth = normalizeMonth(schedule.startMonth ?? schedule.startDate)
      ?? (windowShape ? legacyBudgetStartMonth : undefined);
    if (!startMonth) return [];
    const requestedEndMode = schedule.endMode;
    const endMode = requestedEndMode === "custom"
      || requestedEndMode === "retirement"
      || requestedEndMode === "lifelong"
      ? requestedEndMode
      : "lifelong";
    const endMonth = endMode === "custom"
      ? normalizeMonth(schedule.endMonth ?? schedule.endDate)
      : undefined;
    if (endMode === "custom" && (!endMonth || endMonth < startMonth)) return [];
    const cadence = schedule.cadence === "quarterly"
      || schedule.cadence === "half-yearly"
      || schedule.cadence === "yearly"
      || schedule.cadence === "one-time"
      ? schedule.cadence
      : "monthly";
    const annualMonth = schedule.annualMonth;
    if (cadence === "yearly"
      && (typeof annualMonth !== "number"
        || !Number.isInteger(annualMonth)
        || annualMonth < 0
        || annualMonth > 11)) return [];
    const normalized: StoredBudgetSchedule = {
      id: rowId(schedule.id),
      amount: Math.max(0, asNumber(schedule.amount ?? schedule.monthlyLimit)),
      startMonth,
      ...(cadence !== "monthly" ? { cadence } : {}),
      ...(cadence === "yearly" ? { annualMonth: annualMonth as number } : {}),
      endMode,
      ...(endMonth ? { endMonth } : {}),
      ...(asString(schedule.note).trim() ? { note: asString(schedule.note).trim() } : {}),
    };
    return [normalized];
  });
}

function budgetFromRow(row: BudgetRow) {
  const details = isRecord(row.details) ? row.details : {};
  const schedules = budgetSchedules(details.schedules);
  const normalizedSchedules = schedules.length > 0
    ? schedules
    : [{
        id: `${row.id}-lifelong`,
        amount: asNumber(row.monthlyLimit),
        startMonth: legacyBudgetStartMonth,
        endMode: "lifelong" as const,
      }];
  return {
    category: row.category,
    monthlyLimit: asNumber(row.monthlyLimit),
    schedules: normalizedSchedules,
    windows: normalizedSchedules
      .map((schedule) => omitEmpty({
        id: schedule.id,
        monthlyLimit: schedule.amount,
        startDate: schedule.startMonth === legacyBudgetStartMonth
          ? undefined
          : `${schedule.startMonth}-01`,
        cadence: schedule.cadence,
        annualMonth: schedule.annualMonth,
        endMode: schedule.endMode,
        endDate: schedule.endMonth ? `${schedule.endMonth}-01` : undefined,
        note: schedule.note,
      })),
  };
}

function incomeFromRows(source: IncomeRow, salary: SalaryRow | undefined) {
  const salaryDetails = salary
    ? {
        grossCTC: asNumber(salary.grossCtc),
        grossCTCMode: salaryMode(salary.grossCtcMode),
        basicPay: asNumber(salary.basicPay),
        hra: asNumber(salary.hra),
        allowances: asNumber(salary.allowances),
        employeePF: asNumber(salary.employeePf),
        professionalTax: asNumber(salary.professionalTax),
        tds: asNumber(salary.tds),
        tdsMode: salaryMode(salary.tdsMode),
        taxRegime: salary.taxRegime === "new" || salary.taxRegime === "old"
          ? salary.taxRegime
          : undefined,
        financialYear: salary.financialYear ?? undefined,
        taxRuleVersion: salary.taxRuleVersion ?? undefined,
        otherDeductions: asNumber(salary.otherDeductions),
      }
    : undefined;
  const legacyAnnualSalary = isLegacyAnnualSalary(
    source.type,
    source.frequency,
    source.recurring,
    salaryDetails,
  );
  const frequency = legacyAnnualSalary
    ? "Monthly"
    : normalizedIncomeFrequency(source.frequency, source.recurring);
  const recurring = frequency !== "One-time";
  const endSchedule = incomeEndSchedule(
    source.incomeEndMode,
    source.incomeEndDate,
    recurring,
    frequency,
  );
  return omitEmpty({
    id: source.id,
    name: source.name,
    type: source.type,
    frequency,
    amount: legacyAnnualSalary ? asNumber(source.amount) / 12 : asNumber(source.amount),
    date: source.date,
    recurring,
    annualGrowthRate: recurring ? asOptionalNumber(source.annualGrowthRate) : undefined,
    incomeEndMode: endSchedule.incomeEndMode,
    incomeEndDate: endSchedule.incomeEndDate ?? undefined,
    notes: source.notes || undefined,
    salaryDetails: legacyAnnualSalary && salaryDetails
      ? monthlySalaryDetails(salaryDetails)
      : salaryDetails,
    createdAt: source.createdAt.toISOString(),
  });
}

type StoredRows = {
  profile: Pick<typeof userProfilesTable.$inferSelect, "riskPreference" | "uiPreferences" | "planningData"> | undefined;
  plan:
    | Pick<
        typeof retirementPlansTable.$inferSelect,
        | "targetRetirementAge"
        | "lifeExpectancy"
        | "generalInflationPct"
        | "salaryGrowthPct"
        | "monthlyContributionOverride"
        | "investSurplus"
      >
    | undefined;
  expenses: ExpenseRow[];
  budgets: BudgetRow[];
  incomeSources: IncomeRow[];
  incomeReceipts: IncomeReceiptRow[];
  salary: SalaryRow[];
  investments: InvestmentRow[];
  loans: LoanRow[];
};

/**
 * The single place that turns stored rows into the document the SPA reads.
 * Both reading and writing use it, so a save can answer from the rows it just
 * persisted instead of paying another round trip to read them back.
 */
function buildFinancialData(
  user: typeof usersTable.$inferSelect,
  rows: StoredRows,
): FinancialDataResponse {
  const { profile, plan, expenses, budgets, incomeSources, incomeReceipts, investments, loans } = rows;
  const planningData = isRecord(profile?.planningData) ? profile.planningData : {};
  const salaryBySource = new Map(rows.salary.map((row) => [row.incomeSourceId, row]));

  const dateOfBirth = user.dateOfBirth ?? defaultDateOfBirth();
  const targetRetirementAge = plan?.targetRetirementAge ?? 55;
  const lifeExpectancy = plan?.lifeExpectancy ?? 85;
  const monthlyContributionOverride = asOptionalNumber(plan?.monthlyContributionOverride);

  return {
    expenses: expenses.map((row) =>
      omitEmpty({
        id: row.id,
        date: row.date,
        amount: asNumber(row.amount),
        category: row.category,
        merchant: row.merchant,
        paymentMethod: row.paymentMethod,
        note: row.note || undefined,
        reimbursable: row.reimbursable,
        recurring: row.recurring,
        linkedLoanId: row.loanId ?? undefined,
        createdAt: row.createdAt.toISOString(),
      }),
    ),
    budgets: budgets.map(budgetFromRow),
    incomeSources: incomeSources.map((source) =>
      incomeFromRows(source, salaryBySource.get(source.id)),
    ),
    incomeReceipts: incomeReceipts.map((receipt) => omitEmpty({
      id: receipt.id,
      incomeSourceId: receipt.incomeSourceId,
      receivedDate: receipt.receivedDate,
      amount: asNumber(receipt.amount),
      note: receipt.note || undefined,
      createdAt: receipt.createdAt.toISOString(),
    })),
    investments: investments.map(investmentFromRow),
    loans: loans.map((row) =>
      omitEmpty({
        id: row.id,
        type: row.type,
        name: row.name,
        sanctionedPrincipal: asNumber(row.sanctionedPrincipal),
        outstandingPrincipal: asNumber(row.outstandingPrincipal),
        annualInterestRate: asNumber(row.annualInterestRate),
        interestType: row.interestType,
        totalTenureMonths: row.totalTenureMonths,
        startDate: row.startDate,
        emi: asNumber(row.emi),
        repaymentType:
          row.repaymentType === "bullet" || row.repaymentType === "interest-only-plus-bullet"
            ? row.repaymentType
            : "emi",
        prepayments: asNumber(row.prepayments),
        notes: row.notes || undefined,
        createdAt: row.createdAt.toISOString(),
      }),
    ),
    plannedExpenses: plannedExpenses(planningData.plannedExpenses),
    netWorthSnapshots: normalizeNetWorthSnapshots(planningData.netWorthSnapshots),
    emergencyFund: normalizeEmergencyFund(planningData.emergencyFund),
    goals: normalizeGoals(planningData.goals),
    reminders: normalizeReminders(planningData.customReminders),
    notificationPreferences: normalizeNotificationPreferences(planningData.notificationPreferences),
    notifications: normalizeNotificationState(planningData.notificationState),
    pushSubscriptions: normalizePushSubscriptions(planningData.pushSubscriptions).map(
      ({ p256dh: _p256dh, auth: _auth, ...subscription }) => subscription,
    ),
    monthlyReports: normalizeMonthlyReports(planningData.monthlyReportSnapshots),
    monthlyReportEmailFailures: normalizeMonthlyReportEmailFailures(
      planningData.monthlyReportEmailFailures,
    ),
    retirementInputs: {
      dateOfBirth,
      targetRetirementAge,
      lifeExpectancy,
      generalInflation: asNumber(plan?.generalInflationPct, 6),
      salaryGrowth: asNumber(plan?.salaryGrowthPct, 8),
      monthlyContributionOverride,
      investSurplus: plan?.investSurplus ?? false,
      lifestyleChoice: normalizeLifestyle(planningData.lifestyleChoice),
      customLifestyleExpense: asOptionalNonNegativeNumber(planningData.customLifestyleExpense),
      retirementSpendingAdjustmentPercent: asNumber(planningData.retirementSpendingAdjustmentPercent, 0),
      pensionSources: normalizePensionSources(planningData.pensionSources),
    },
    profileInputs: {
      fullName: user.fullName ?? undefined,
      gender: user.gender ?? undefined,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      onboardingCompleted: user.onboardingCompleted,
      onboardingProgress: onboardingProgress(planningData.onboardingProgress),
      dateOfBirth,
      targetRetirementAge,
      lifeExpectancy,
      riskPreference: profile?.riskPreference ?? "Balanced",
    },
    uiPreferences: normalizeUiPreferences(profile?.uiPreferences),
  };
}

export async function loadFinancialData(
  user: typeof usersTable.$inferSelect,
): Promise<FinancialDataResponse> {
  const [profile, plan, expenses, budgets, incomeSources, incomeReceipts, investments, loans] =
    await Promise.all([
      db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, user.id)).limit(1),
      db.select().from(retirementPlansTable).where(eq(retirementPlansTable.userId, user.id)).limit(1),
      db.select().from(expensesTable).where(eq(expensesTable.userId, user.id)),
      db.select().from(budgetsTable).where(eq(budgetsTable.userId, user.id)),
      db.select().from(incomeSourcesTable).where(eq(incomeSourcesTable.userId, user.id)),
      db.select().from(incomeReceiptsTable).where(eq(incomeReceiptsTable.userId, user.id)),
      db.select().from(investmentsTable).where(eq(investmentsTable.userId, user.id)),
      db.select().from(loansTable).where(eq(loansTable.userId, user.id)),
    ]);

  const salary =
    incomeSources.length === 0
      ? []
      : await db
          .select()
          .from(salaryDetailsTable)
          .where(
            inArray(
              salaryDetailsTable.incomeSourceId,
              incomeSources.map((source) => source.id),
            ),
          );

  return buildFinancialData(user, {
    profile: profile[0],
    plan: plan[0],
    expenses,
    budgets,
    incomeSources,
    incomeReceipts,
    salary,
    investments,
    loans,
  });
}

type FinancialTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function loadFinancialDataInTransaction(
  tx: FinancialTransaction,
  user: typeof usersTable.$inferSelect,
): Promise<FinancialDataResponse> {
  const profile = await tx.select().from(userProfilesTable)
    .where(eq(userProfilesTable.userId, user.id)).limit(1);
  const plan = await tx.select().from(retirementPlansTable)
    .where(eq(retirementPlansTable.userId, user.id)).limit(1);
  const expenses = await tx.select().from(expensesTable)
    .where(eq(expensesTable.userId, user.id));
  const budgets = await tx.select().from(budgetsTable)
    .where(eq(budgetsTable.userId, user.id));
  const incomeSources = await tx.select().from(incomeSourcesTable)
    .where(eq(incomeSourcesTable.userId, user.id));
  const incomeReceipts = await tx.select().from(incomeReceiptsTable)
    .where(eq(incomeReceiptsTable.userId, user.id));
  const investments = await tx.select().from(investmentsTable)
    .where(eq(investmentsTable.userId, user.id));
  const loans = await tx.select().from(loansTable)
    .where(eq(loansTable.userId, user.id));
  const salary = incomeSources.length === 0 ? [] : await tx.select()
    .from(salaryDetailsTable).where(inArray(
      salaryDetailsTable.incomeSourceId,
      incomeSources.map((source) => source.id),
    ));
  return buildFinancialData(user, {
    profile: profile[0], plan: plan[0], expenses, budgets, incomeSources,
    incomeReceipts, salary, investments, loans,
  });
}

export async function captureCanonicalAdmissionBaseline(
  tx: FinancialTransaction,
  user: typeof usersTable.$inferSelect,
): Promise<number> {
  return Buffer.byteLength(JSON.stringify(
    financialSaveMutationDocument(await loadFinancialDataInTransaction(tx, user)),
  ));
}

export async function assertCanonicalMutationAdmission(
  tx: FinancialTransaction,
  user: typeof usersTable.$inferSelect,
  baselineBytes: number,
  admissionLimit = FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT,
): Promise<void> {
  const resultingBytes = Buffer.byteLength(JSON.stringify(
    financialSaveMutationDocument(await loadFinancialDataInTransaction(tx, user)),
  ));
  if (resultingBytes > admissionLimit && resultingBytes > baselineBytes) {
    throw new FinancialSaveSizeLimitError(resultingBytes, admissionLimit);
  }
}

/** Internal delivery path only; public financial-data responses intentionally redact these keys. */
export async function loadPushSubscriptionsForUser(userId: string) {
  const [profile] = await db.select({ planningData: userProfilesTable.planningData })
    .from(userProfilesTable).where(eq(userProfilesTable.userId, userId)).limit(1);
  return normalizePushSubscriptions(profile?.planningData?.pushSubscriptions);
}

export async function loadMonthlyReportEmailDeliveriesForUser(userId: string) {
  const [profile] = await db.select({ planningData: userProfilesTable.planningData })
    .from(userProfilesTable).where(eq(userProfilesTable.userId, userId)).limit(1);
  const value = (profile?.planningData as PlanningDataWithReportDelivery | undefined)
    ?.monthlyReportEmailDeliveries;
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([month, deliveredAt]) => {
    const normalizedMonth = normalizeMonth(month);
    return normalizedMonth && typeof deliveredAt === "string"
      ? [[normalizedMonth, timestamp(deliveredAt)]]
      : [];
  }));
}

function normalizeMonthlyReportEmailFailures(value: unknown): FinancialDataResponse["monthlyReportEmailFailures"] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([month, failure]) => {
    const normalizedMonth = normalizeMonth(month);
    if (!normalizedMonth || !isRecord(failure)) return [];
    const category = failure.category;
    if (category !== "report_too_large" && category !== "email_unavailable" && category !== "temporary") return [];
    const failedAt = timestamp(failure.failedAt);
    return [[normalizedMonth, { category, failedAt }]];
  }));
}

export class PlanningCategoryConflictError extends Error {}

/**
 * Raised rather than silently trimming a goal allocation.  A client can use
 * the figures to explain the conflict and, importantly, a stale client cannot
 * commit more of the account's cash flow than is available.
 */
export class GoalAllocationConflictError extends Error {
  readonly code = "GOAL_ALLOCATION_EXCEEDS_SURPLUS";

  constructor(
    readonly allocated: number,
    readonly available: number,
  ) {
    super(`Goal allocations of ${allocated.toFixed(2)} exceed confirmed monthly surplus of ${available.toFixed(2)}`);
    this.name = "GoalAllocationConflictError";
  }
}

type CashFlowRow = {
  id?: unknown;
  name?: unknown;
  amount?: unknown;
  date?: unknown;
  loanId?: unknown;
  linkedLoanId?: unknown;
  reimbursable?: unknown;
  merchant?: unknown;
  note?: unknown;
  frequency?: unknown;
  recurring?: unknown;
  incomeEndMode?: unknown;
  incomeEndDate?: unknown;
  type?: unknown;
  salaryDetails?: unknown;
  monthlyLimit?: unknown;
  windows?: unknown;
  details?: unknown;
  emi?: unknown;
  startDate?: unknown;
  totalTenureMonths?: unknown;
  repaymentType?: unknown;
  annualInterestRate?: unknown;
  outstandingPrincipal?: unknown;
  monthlyContribution?: unknown;
  contributionStartDate?: unknown;
  contributionEndMode?: unknown;
  contributionEndDate?: unknown;
  autoManagedContribution?: unknown;
  linkedIncomeSourceId?: unknown;
};

function budgetHasEffectivePlan(row: CashFlowRow): boolean {
  const details = isRecord(row.details) ? row.details : {};
  const windows = Array.isArray(row.windows)
    ? row.windows
    : Array.isArray(details.schedules)
      ? details.schedules
      : [];
  if (windows.length === 0) return Math.max(0, asNumber(row.monthlyLimit)) > 0;
  return windows.filter(isRecord).some((window) =>
    Math.max(0, asNumber(window.monthlyLimit ?? window.amount)) > 0);
}

function loanExpenseText(value: unknown): string {
  return asString(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isLivingCostExpense(
  expense: CashFlowRow,
  loans: CashFlowRow[],
  currentMonth: string,
  currentDate: string,
  asOf: Date,
): boolean {
  const amount = Math.max(0, asNumber(expense.amount));
  if (amount <= 0 || expense.reimbursable === true || expense.loanId || expense.linkedLoanId) return false;
  const text = loanExpenseText(`${asString(expense.merchant)} ${asString(expense.note)}`);
  return !loans.some((loan) => {
    const payment = loanPaymentForMonth(loan, currentMonth, currentDate, asOf);
    if (payment <= 0 || Math.abs(amount - payment) > Math.max(1, payment * 0.01)) return false;
    const name = loanExpenseText(loan.name);
    const type = loanExpenseText(loan.type);
    return /\b(emi|loan|mortgage)\b/.test(text)
      || (name.length >= 3 && text.includes(name))
      || (type.length >= 4 && text.includes(type));
  });
}

/**
 * Matches the Goals screen's living-cost fallback: average up to three
 * completed calendar months with observed spend, or normalize the current
 * partial month when no completed history exists.
 */
function actualMonthlyLivingCost(
  expenses: CashFlowRow[],
  loans: CashFlowRow[],
  asOf: Date,
): number {
  const monthKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const currentMonth = monthKey(asOf);
  const currentDate = `${currentMonth}-${String(asOf.getDate()).padStart(2, "0")}`;
  const ordinary = expenses.flatMap((row) => {
    const date = new Date(asString(row.date));
    return Number.isFinite(date.getTime()) && date <= asOf
      && isLivingCostExpense(row, loans, currentMonth, currentDate, asOf)
      ? [{ row, date }]
      : [];
  });
  if (ordinary.length === 0) return 0;
  const completed: number[] = [];
  for (let offset = -3; offset <= -1; offset += 1) {
    const month = new Date(asOf.getFullYear(), asOf.getMonth() + offset, 1);
    const key = monthKey(month);
    const total = ordinary
      .filter((expense) => monthKey(expense.date) === key)
      .reduce((sum, expense) => sum + Math.max(0, asNumber(expense.row.amount)), 0);
    if (total > 0) completed.push(total);
  }
  if (completed.length > 0) {
    return completed.reduce((sum, total) => sum + total, 0) / completed.length;
  }
  const currentTotal = ordinary
    .filter((expense) => monthKey(expense.date) === currentMonth)
    .reduce((sum, expense) => sum + Math.max(0, asNumber(expense.row.amount)), 0);
  const daysInMonth = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate();
  const elapsedDays = Math.max(1, Math.min(daysInMonth, asOf.getDate()));
  return Math.max(currentTotal, currentTotal * daysInMonth / elapsedDays);
}

function monthlyNetIncome(source: CashFlowRow, month: string, currentDate: string): number {
  if (source.recurring === false || source.frequency !== "Monthly") return 0;
  const start = normalizeMonth(source.date);
  const end = normalizeMonth(source.incomeEndDate);
  const startDate = asString(source.date).slice(0, 10);
  if ((/^\d{4}-\d{2}-\d{2}$/.test(startDate) && startDate > currentDate)
    || (start && start > month)
    || (source.incomeEndMode === "custom" && end && end < month)) return 0;
  const details = isRecord(source.salaryDetails) ? source.salaryDetails : undefined;
  if (source.type !== "Salary" || !details) return Math.max(0, asNumber(source.amount));
  return Math.max(0,
    asNumber(details.basicPay) + asNumber(details.hra) + asNumber(details.allowances)
      - asNumber(details.employeePF ?? details.employeePf) - asNumber(details.professionalTax)
      - asNumber(details.tds) - asNumber(details.otherDeductions),
  );
}

function investmentContributionForMonth(row: CashFlowRow, month: string, currentDate: string) {
  const start = normalizeMonth(row.contributionStartDate);
  const end = normalizeMonth(row.contributionEndDate);
  const startDate = asString(row.contributionStartDate).slice(0, 10);
  if ((/^\d{4}-\d{2}-\d{2}$/.test(startDate) && startDate > currentDate)
    || (start && start > month)
    || (row.contributionEndMode === "custom" && end && end < month)) return 0;
  return Math.max(0, asNumber(row.monthlyContribution));
}

function loanPaymentForMonth(
  row: CashFlowRow,
  month: string,
  currentDate = `${month}-01`,
  asOf = new Date(`${currentDate}T00:00:00`),
) {
  if (asNumber(row.outstandingPrincipal) <= 0) return 0;
  const start = normalizeMonth(row.startDate);
  const startDate = asString(row.startDate).slice(0, 10);
  if ((/^\d{4}-\d{2}-\d{2}$/.test(startDate) && startDate > currentDate)
    || (start && start > month)) return 0;
  const principal = Math.max(0, asNumber(row.outstandingPrincipal));
  const emi = Math.max(0, asNumber(row.emi));
  const monthlyRate = Math.max(0, asNumber(row.annualInterestRate)) / 1200;
  const repaymentType = row.repaymentType ?? "emi";
  if (repaymentType === "emi" && emi <= 0) return 0;
  const startInstant = /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? new Date(`${startDate}T00:00:00`)
    : undefined;
  const elapsed = startInstant
    ? Math.max(0, Math.floor((asOf.getTime() - startInstant.getTime()) / (30.4375 * 86_400_000)))
    : 0;
  const fallbackMonths = Math.max(
    1,
    Math.min(1200, Math.ceil(Math.max(1, asNumber(row.totalTenureMonths)) - elapsed)),
  );
  let remainingMonths = fallbackMonths;
  if (repaymentType === "emi" && monthlyRate === 0) {
    remainingMonths = Math.max(1, Math.min(1200, Math.ceil(principal / emi)));
  } else if (repaymentType === "emi" && emi > principal * monthlyRate) {
    const calculated = Math.ceil(-Math.log(1 - principal * monthlyRate / emi) / Math.log(1 + monthlyRate));
    if (Number.isFinite(calculated) && calculated > 0) remainingMonths = Math.min(1200, calculated);
  }
  if (row.repaymentType === "bullet") {
    return remainingMonths === 1
      ? principal + principal * monthlyRate
      : 0;
  }
  if (row.repaymentType === "interest-only-plus-bullet") {
    return principal * monthlyRate + (remainingMonths === 1 ? principal : 0);
  }
  return emi;
}

function budgetAmountForMonth(row: CashFlowRow, month: string): number {
  const details = isRecord(row.details) ? row.details : {};
  const rawWindows = Array.isArray(row.windows)
    ? row.windows
    : Array.isArray(details.schedules)
      ? details.schedules
      : [];
  if (rawWindows.length === 0) return Math.max(0, asNumber(row.monthlyLimit));
  const targetIndex = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
  return rawWindows.filter(isRecord).reduce((total, window) => {
    const start = normalizeMonth(window.startDate ?? window.startMonth) ?? "1900-01";
    const end = normalizeMonth(window.endDate ?? window.endMonth);
    if (month < start || (window.endMode === "custom" && end && month > end)) return total;
    const startIndex = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1;
    const elapsed = targetIndex - startIndex;
    const cadence = asString(window.cadence, "monthly");
    const occurs = cadence === "monthly"
      || (cadence === "quarterly" && elapsed >= 0 && elapsed % 3 === 0)
      || (cadence === "half-yearly" && elapsed >= 0 && elapsed % 6 === 0)
      || (cadence === "one-time" && elapsed === 0)
      || (cadence === "yearly" && Number(window.annualMonth) === Number(month.slice(5, 7)) - 1);
    return occurs ? total + Math.max(0, asNumber(window.monthlyLimit ?? window.amount)) : total;
  }, 0);
}

function confirmedMonthlySurplus(input: {
  income: CashFlowRow[];
  budgets: CashFlowRow[];
  expenses: CashFlowRow[];
  loans: CashFlowRow[];
  investments: CashFlowRow[];
  emergencyFund?: unknown;
}): number {
  const asOf = new Date();
  const currentMonth = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}`;
  const currentDate = `${currentMonth}-${String(asOf.getDate()).padStart(2, "0")}`;
  const income = input.income.reduce(
    (total, row) => total + monthlyNetIncome(row, currentMonth, currentDate), 0,
  );
  // Match the Goals projection: any effective budget plan owns the baseline,
  // even when its schedule has no occurrence this month. Without a plan, use
  // the same observed-month average as the browser rather than summing history.
  const budgetTotal = input.budgets.reduce((total, row) => total + budgetAmountForMonth(row, currentMonth), 0);
  const livingCosts = input.budgets.some(budgetHasEffectivePlan)
    ? budgetTotal
    : actualMonthlyLivingCost(input.expenses, input.loans, asOf);
  const emi = input.loans.reduce(
    (total, row) => total + loanPaymentForMonth(row, currentMonth, currentDate, asOf), 0,
  );
  const existingSips = input.investments.reduce(
    (total, row) => total + (
      row.autoManagedContribution === true && Boolean(row.linkedIncomeSourceId)
        ? 0
        : investmentContributionForMonth(row, currentMonth, currentDate)
    ), 0,
  );
  const emergencyPlan = normalizeEmergencyFund(input.emergencyFund);
  const emergencyTarget = livingCosts * emergencyPlan.targetMonths;
  const emergency = emergencyPlan.reserveBalance >= emergencyTarget
    ? 0
    : Math.min(emergencyPlan.monthlyContribution, emergencyTarget - emergencyPlan.reserveBalance);
  return Math.max(0, income - livingCosts - emi - existingSips - emergency);
}

function assertGoalAllocationsWithinSurplus(
  goals: NonNullable<StoredPlanningData["goals"]>,
  cashFlow: Parameters<typeof confirmedMonthlySurplus>[0],
) {
  // A brand-new account has not confirmed a monthly cash-flow baseline yet.
  // Do not manufacture a zero-surplus fact from an empty ledger; as soon as
  // any monthly fact exists, the persisted values above are authoritative.
  if (
    cashFlow.income.length === 0 && cashFlow.budgets.length === 0
    && cashFlow.expenses.length === 0 && cashFlow.loans.length === 0
    && cashFlow.investments.length === 0
  ) return;
  const allocated = goals.reduce((total, goal) => total + goal.monthlyAllocation, 0);
  const available = confirmedMonthlySurplus(cashFlow);
  // Currency is stored at two decimal places; do not reject a harmless binary
  // floating-point fraction.
  if (allocated > available + 0.005) throw new GoalAllocationConflictError(allocated, available);
}

export async function managePlanningCategory(
  user: typeof usersTable.$inferSelect,
  category: string,
  action: "archive" | "rename" | "restore",
  nextCategory?: string,
  financialDocumentAdmissionLimit = FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT,
): Promise<FinancialDataResponse> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${financialLifecycleLockKey(user.id)}))`);
    const admissionBaseline = await captureCanonicalAdmissionBaseline(tx, user);
    const [budgetRows, profileRows] = await Promise.all([
      tx.select().from(budgetsTable).where(eq(budgetsTable.userId, user.id)),
      tx.select().from(userProfilesTable).where(eq(userProfilesTable.userId, user.id)).limit(1),
    ]);
    const sourceBudget = budgetRows.find((budget) => budget.category === category);
    const normalizedNext = nextCategory?.trim();

    if (
      normalizedNext
      && budgetRows.some((budget) =>
        budget.id !== sourceBudget?.id
        && budget.category.toLocaleLowerCase() === normalizedNext.toLocaleLowerCase()
      )
    ) {
      throw new PlanningCategoryConflictError("A planning category with that name already exists");
    }

    if (normalizedNext) {
      if (sourceBudget) {
        await tx
          .update(budgetsTable)
          .set({ category: normalizedNext, updatedAt: new Date() })
          .where(eq(budgetsTable.id, sourceBudget.id));
      } else {
        await tx.insert(budgetsTable).values({
          id: crypto.randomUUID(),
          userId: user.id,
          category: normalizedNext,
          monthlyLimit: "0",
          details: {},
        });
      }
    }
    if (action === "restore" && !sourceBudget) {
      await tx.insert(budgetsTable).values({
        id: crypto.randomUUID(),
        userId: user.id,
        category,
        monthlyLimit: "0",
        details: {
          schedules: [{
            id: crypto.randomUUID(),
            amount: 0,
            startMonth: legacyBudgetStartMonth,
            endMode: "lifelong",
          }],
        },
      });
    }

    const existingProfile = profileRows[0];
    const uiPreferences = normalizeUiPreferences(existingProfile?.uiPreferences);
    const archived = new Set(uiPreferences.archivedPlanningCategories);
    if (action === "rename" && normalizedNext) {
      archived.add(category);
      archived.delete(normalizedNext);
    } else if (action === "restore") {
      archived.delete(category);
    } else if (action === "archive") {
      archived.add(category);
    }
    const nextUiPreferences = {
      ...uiPreferences,
      archivedPlanningCategories: Array.from(archived),
    };

    if (existingProfile) {
      await tx
        .update(userProfilesTable)
        .set({ uiPreferences: nextUiPreferences, updatedAt: new Date() })
        .where(eq(userProfilesTable.userId, user.id));
    } else {
      await tx.insert(userProfilesTable).values({
        userId: user.id,
        uiPreferences: nextUiPreferences,
      });
    }
    await assertCanonicalMutationAdmission(
      tx, user, admissionBaseline, financialDocumentAdmissionLimit,
    );
  });

  return loadFinancialData(user);
}

export async function updateFinancialHealthPlanning(
  user: typeof usersTable.$inferSelect,
  update: {
    emergencyFund?: unknown;
    netWorthSnapshot?: unknown;
  },
  financialDocumentAdmissionLimit = FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT,
): Promise<FinancialDataResponse> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${financialLifecycleLockKey(user.id)}))`);
    const admissionBaseline = await captureCanonicalAdmissionBaseline(tx, user);
    await tx
      .insert(userProfilesTable)
      .values({ userId: user.id })
      .onConflictDoNothing();
    await tx.execute(sql`
      select user_id from user_profiles where user_id = ${user.id} for update
    `);
    const [profile] = await tx
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, user.id))
      .limit(1);
    const current = isRecord(profile?.planningData) ? profile.planningData : {};
    const nextSnapshots = update.netWorthSnapshot === undefined
      ? normalizeNetWorthSnapshots(current.netWorthSnapshots)
      : normalizeNetWorthSnapshots([
        ...asArray(current.netWorthSnapshots),
        update.netWorthSnapshot,
      ]);
    const nextPlanningData = {
      ...current,
      netWorthSnapshots: nextSnapshots,
      emergencyFund: update.emergencyFund === undefined
        ? normalizeEmergencyFund(current.emergencyFund)
        : normalizeEmergencyFund(update.emergencyFund),
    };

    await tx
      .update(userProfilesTable)
      .set({ planningData: nextPlanningData, updatedAt: new Date() })
      .where(eq(userProfilesTable.userId, user.id));
    await assertCanonicalMutationAdmission(
      tx, user, admissionBaseline, financialDocumentAdmissionLimit,
    );
  });

  return loadFinancialData(user);
}

type PlanningFeaturesUpdate = {
  goals?: unknown;
  customReminders?: unknown;
  notificationPreferences?: unknown;
  notification?: unknown;
  notificationStateUpdate?: { id: string; read?: boolean; dismissed?: boolean };
  pushDeliveredNotificationId?: string;
  pushSubscription?: unknown;
  removePushEndpoint?: string;
  monthlyReportSnapshot?: unknown;
  monthlyReportEmailDeliveredMonth?: string;
  monthlyReportEmailClearFailureMonth?: string;
  monthlyReportEmailFailure?: {
    month: string;
    category: MonthlyReportEmailFailureCategory;
    failedAt?: string;
  };
};

export async function updatePlanningFeatures(
  user: typeof usersTable.$inferSelect,
  update: PlanningFeaturesUpdate,
  financialDocumentAdmissionLimit = FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT,
): Promise<FinancialDataResponse> {
  let notificationFound = true;
  const incomingPushSubscription = update.pushSubscription === undefined
    ? undefined
    : normalizePushSubscriptions([update.pushSubscription])[0];
  await db.transaction(async (tx) => {
    if (incomingPushSubscription) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${incomingPushSubscription.endpoint}))`);
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${financialLifecycleLockKey(user.id)}))`);
    const admissionBaseline = await captureCanonicalAdmissionBaseline(tx, user);
    await tx.insert(userProfilesTable).values({ userId: user.id }).onConflictDoNothing();
    await tx.execute(sql`select user_id from user_profiles where user_id = ${user.id} for update`);
    const [profile] = await tx
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, user.id))
      .limit(1);
    const current = (isRecord(profile?.planningData) ? profile.planningData : {}) as PlanningDataWithReportDelivery;
    const next: PlanningDataWithReportDelivery = { ...current };

    if (update.goals !== undefined) {
      const goals = normalizeGoals(update.goals);
      const previousGoals = normalizeGoals(current.goals);
      const previousCommitment = previousGoals.reduce(
        (sum, goal) => sum + goal.monthlyAllocation, 0,
      );
      const nextCommitment = goals.reduce((sum, goal) => sum + goal.monthlyAllocation, 0);
      const [income, budgets, expenses, loans, investments] = await Promise.all([
        tx.select().from(incomeSourcesTable).where(eq(incomeSourcesTable.userId, user.id)),
        tx.select().from(budgetsTable).where(eq(budgetsTable.userId, user.id)),
        tx.select().from(expensesTable).where(eq(expensesTable.userId, user.id)),
        tx.select().from(loansTable).where(eq(loansTable.userId, user.id)),
        tx.select().from(investmentsTable).where(eq(investmentsTable.userId, user.id)),
      ]);
      const salary = income.length === 0 ? [] : await tx.select().from(salaryDetailsTable).where(
        inArray(salaryDetailsTable.incomeSourceId, income.map((source) => source.id)),
      );
      const salaryByIncome = new Map(salary.map((row) => [row.incomeSourceId, row]));
      if (nextCommitment > previousCommitment + 0.005) {
        assertGoalAllocationsWithinSurplus(goals, {
          income: income.map((row) => ({ ...row, salaryDetails: salaryByIncome.get(row.id) })),
          budgets,
          expenses,
          loans,
          investments,
          emergencyFund: current.emergencyFund,
        });
      }
      next.goals = goals;
    }
    if (update.customReminders !== undefined) {
      next.customReminders = normalizeReminders(update.customReminders);
    }
    if (update.notificationPreferences !== undefined) {
      next.notificationPreferences = normalizeNotificationPreferences(update.notificationPreferences);
    }
    if (update.notification !== undefined) {
      const existing = normalizeNotificationState(current.notificationState);
      const candidate = normalizeNotificationState([update.notification])[0];
      next.notificationState = candidate && !existing.some((item) => item.dedupeKey === candidate.dedupeKey)
        ? normalizeNotificationState([...existing, candidate])
        : existing;
    }
    if (update.notificationStateUpdate) {
      const now = new Date().toISOString();
      const existing = normalizeNotificationState(current.notificationState);
      notificationFound = existing.some((item) => item.id === update.notificationStateUpdate!.id);
      next.notificationState = existing.map((item) => item.id === update.notificationStateUpdate!.id
        ? {
            ...item,
            ...(update.notificationStateUpdate!.read ? { readAt: item.readAt ?? now } : {}),
            ...(update.notificationStateUpdate!.dismissed
              ? { dismissedAt: item.dismissedAt ?? now }
              : {}),
          }
        : item);
    }
    if (update.pushDeliveredNotificationId) {
      const existing = normalizeNotificationState(current.notificationState);
      next.notificationState = existing.map((item) => item.id === update.pushDeliveredNotificationId
        ? { ...item, pushDeliveredAt: item.pushDeliveredAt ?? new Date().toISOString() }
        : item);
    }
    if (update.pushSubscription !== undefined) {
      if (incomingPushSubscription) {
        const profiles = await tx.select({
          userId: userProfilesTable.userId,
          planningData: userProfilesTable.planningData,
        }).from(userProfilesTable);
        for (const owner of profiles) {
          if (owner.userId === user.id) continue;
          const ownerHasEndpoint = normalizePushSubscriptions(owner.planningData?.pushSubscriptions)
            .some((item) => item.endpoint === incomingPushSubscription.endpoint);
          if (!ownerHasEndpoint) continue;
          await tx.execute(sql`select user_id from user_profiles where user_id = ${owner.userId} for update`);
          const [lockedOwner] = await tx.select({ planningData: userProfilesTable.planningData })
            .from(userProfilesTable)
            .where(eq(userProfilesTable.userId, owner.userId))
            .limit(1);
          const ownerPlanning = isRecord(lockedOwner?.planningData) ? lockedOwner.planningData : {};
          const retained = normalizePushSubscriptions(ownerPlanning.pushSubscriptions)
            .filter((item) => item.endpoint !== incomingPushSubscription.endpoint);
          if (retained.length !== normalizePushSubscriptions(ownerPlanning.pushSubscriptions).length) {
            await tx.update(userProfilesTable)
              .set({ planningData: { ...ownerPlanning, pushSubscriptions: retained }, updatedAt: new Date() })
              .where(eq(userProfilesTable.userId, owner.userId));
          }
        }
      }
      next.pushSubscriptions = normalizePushSubscriptions([
        ...asArray(current.pushSubscriptions),
        ...(incomingPushSubscription ? [incomingPushSubscription] : []),
      ]);
    }
    if (update.removePushEndpoint !== undefined) {
      next.pushSubscriptions = normalizePushSubscriptions(current.pushSubscriptions)
        .filter((item) => item.endpoint !== update.removePushEndpoint);
    }
    if (update.monthlyReportSnapshot !== undefined) {
      const existing = normalizeMonthlyReports(current.monthlyReportSnapshots);
      const candidate = normalizeMonthlyReports([update.monthlyReportSnapshot])[0];
      const prior = candidate ? existing.find((item) => item.month === candidate.month) : undefined;
      next.monthlyReportSnapshots = candidate && !prior
        ? normalizeMonthlyReports([...existing, candidate])
        : candidate?.retirementForecast && prior && !prior.retirementForecast
          ? normalizeMonthlyReports(existing.map((item) => item.month === candidate.month ? candidate : item))
          : existing;
    }
    if (normalizeMonth(update.monthlyReportEmailDeliveredMonth)) {
      const deliveredMonth = normalizeMonth(update.monthlyReportEmailDeliveredMonth)!;
      next.monthlyReportEmailDeliveries = {
        ...(isRecord(current.monthlyReportEmailDeliveries) ? current.monthlyReportEmailDeliveries : {}),
        [deliveredMonth]: new Date().toISOString(),
      };
      const failures = normalizeMonthlyReportEmailFailures(current.monthlyReportEmailFailures);
      delete failures[deliveredMonth];
      next.monthlyReportEmailFailures = failures;
    }
    if (normalizeMonth(update.monthlyReportEmailClearFailureMonth)) {
      const clearedMonth = normalizeMonth(update.monthlyReportEmailClearFailureMonth)!;
      const failures = normalizeMonthlyReportEmailFailures(current.monthlyReportEmailFailures);
      delete failures[clearedMonth];
      next.monthlyReportEmailFailures = failures;
    }
    if (update.monthlyReportEmailFailure && normalizeMonth(update.monthlyReportEmailFailure.month)) {
      const failureMonth = normalizeMonth(update.monthlyReportEmailFailure.month)!;
      next.monthlyReportEmailFailures = {
        ...normalizeMonthlyReportEmailFailures(current.monthlyReportEmailFailures),
        [failureMonth]: {
          category: update.monthlyReportEmailFailure.category,
          failedAt: timestamp(update.monthlyReportEmailFailure.failedAt),
        },
      };
    }
    const plan = await tx.select().from(retirementPlansTable)
      .where(eq(retirementPlansTable.userId, user.id)).limit(1);
    const expenses = await tx.select().from(expensesTable)
      .where(eq(expensesTable.userId, user.id));
    const budgets = await tx.select().from(budgetsTable)
      .where(eq(budgetsTable.userId, user.id));
    const incomeSources = await tx.select().from(incomeSourcesTable)
      .where(eq(incomeSourcesTable.userId, user.id));
    const incomeReceipts = await tx.select().from(incomeReceiptsTable)
      .where(eq(incomeReceiptsTable.userId, user.id));
    const investments = await tx.select().from(investmentsTable)
      .where(eq(investmentsTable.userId, user.id));
    const loans = await tx.select().from(loansTable)
      .where(eq(loansTable.userId, user.id));
    const salary = incomeSources.length === 0
      ? []
      : await tx.select().from(salaryDetailsTable).where(inArray(
        salaryDetailsTable.incomeSourceId,
        incomeSources.map((source) => source.id),
      ));
    const storedRows = {
      plan: plan[0],
      expenses,
      budgets,
      incomeSources,
      incomeReceipts,
      salary,
      investments,
      loans,
    };
    const currentData = buildFinancialData(user, {
      ...storedRows,
      profile: {
        riskPreference: profile?.riskPreference ?? "Balanced",
        uiPreferences: profile?.uiPreferences ?? {},
        planningData: current,
      },
    });
    const nextData = buildFinancialData(user, {
      ...storedRows,
      profile: {
        riskPreference: profile?.riskPreference ?? "Balanced",
        uiPreferences: profile?.uiPreferences ?? {},
        planningData: next,
      },
    });
    const currentBytes = Buffer.byteLength(
      JSON.stringify(financialSaveMutationDocument(currentData)),
    );
    const nextBytes = Buffer.byteLength(
      JSON.stringify(financialSaveMutationDocument(nextData)),
    );
    if (nextBytes > financialDocumentAdmissionLimit && nextBytes > currentBytes) {
      throw new FinancialSaveSizeLimitError(
        nextBytes,
        financialDocumentAdmissionLimit,
      );
    }
    await tx
      .update(userProfilesTable)
      .set({ planningData: next, updatedAt: new Date() })
      .where(eq(userProfilesTable.userId, user.id));
    await assertCanonicalMutationAdmission(
      tx,
      user,
      admissionBaseline,
      financialDocumentAdmissionLimit,
    );
  });
  if (!notificationFound) throw new NotificationStateNotFoundError();
  return loadFinancialData(user);
}

export class NotificationStateNotFoundError extends Error {}

export async function updateRetirementPlanning(
  user: typeof usersTable.$inferSelect,
  retirementInputs: Record<string, unknown>,
  financialDocumentAdmissionLimit = FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT,
): Promise<FinancialDataResponse> {
  const targetRetirementAge = Math.round(asNumber(retirementInputs.targetRetirementAge, 55));
  const lifeExpectancy = Math.round(asNumber(retirementInputs.lifeExpectancy, 85));
  const generalInflationPct = money(retirementInputs.generalInflation, 6);
  const salaryGrowthPct = money(retirementInputs.salaryGrowth, 8);
  const contributionOverride = optionalMoney(retirementInputs.monthlyContributionOverride);
  const investSurplus = asBoolean(retirementInputs.investSurplus, false);
  const lifestyleChoice = normalizeLifestyle(retirementInputs.lifestyleChoice);
  const customLifestyleExpense = asOptionalNonNegativeNumber(retirementInputs.customLifestyleExpense);
  const retirementSpendingAdjustmentPercent = Math.max(
    -90,
    Math.min(300, asNumber(retirementInputs.retirementSpendingAdjustmentPercent, 0)),
  );
  const pensionSources = normalizePensionSources(retirementInputs.pensionSources);
  const istNow = sql`timezone('Asia/Kolkata', now())`;

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${financialLifecycleLockKey(user.id)}))`);
    const admissionBaseline = await captureCanonicalAdmissionBaseline(tx, user);
    await tx
      .insert(userProfilesTable)
      .values({ userId: user.id })
      .onConflictDoNothing();
    await tx.execute(sql`
      select user_id from user_profiles where user_id = ${user.id} for update
    `);
    const [profile] = await tx
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, user.id))
      .limit(1);
    const current = isRecord(profile?.planningData) ? profile.planningData : {};
    const nextPlanningData = {
      ...current,
      ...(lifestyleChoice ? { lifestyleChoice } : {}),
      ...(customLifestyleExpense !== undefined ? { customLifestyleExpense } : {}),
      retirementSpendingAdjustmentPercent,
      pensionSources,
    };

    await tx
      .update(userProfilesTable)
      .set({ planningData: nextPlanningData, updatedAt: new Date() })
      .where(eq(userProfilesTable.userId, user.id));
    await tx.execute(sql`
      insert into retirement_plans (
        user_id,
        target_retirement_age,
        life_expectancy,
        general_inflation_pct,
        salary_growth_pct,
        monthly_contribution_override,
        invest_surplus,
        updated_at
      )
      values (
        ${user.id},
        ${targetRetirementAge},
        ${lifeExpectancy},
        ${generalInflationPct},
        ${salaryGrowthPct},
        ${contributionOverride},
        ${investSurplus},
        ${istNow}
      )
      on conflict (user_id) do update
        set target_retirement_age = excluded.target_retirement_age,
            life_expectancy = excluded.life_expectancy,
            general_inflation_pct = excluded.general_inflation_pct,
            salary_growth_pct = excluded.salary_growth_pct,
            monthly_contribution_override = excluded.monthly_contribution_override,
            invest_surplus = excluded.invest_surplus,
            updated_at = excluded.updated_at
    `);
    await assertCanonicalMutationAdmission(
      tx, user, admissionBaseline, financialDocumentAdmissionLimit,
    );
  });

  return loadFinancialData(user);
}

export async function saveFinancialData(
  user: typeof usersTable.$inferSelect,
  payload: Record<string, unknown>,
  legacyBlob?: Record<string, unknown>,
  mode: "save" | "restore" = "save",
  accountMutation?: FinancialRestoreAccountMutation,
  financialDocumentAdmissionLimit = FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT,
): Promise<FinancialDataResponse> {
  const profileInputs = isRecord(payload.profileInputs)
    ? payload.profileInputs
    : isRecord(legacyBlob)
      ? legacyBlob
      : {};
  const retirementInputs = isRecord(payload.retirementInputs)
    ? payload.retirementInputs
    : isRecord(legacyBlob)
      ? legacyBlob
      : {};

  const expenses = asArray(payload.expenses ?? legacyBlob?.expenses);
  const budgets = asArray(payload.budgets ?? legacyBlob?.budgets);
  const incomeSources = asArray(payload.incomeSources ?? legacyBlob?.incomeSources);
  const incomeReceipts = asArray(payload.incomeReceipts ?? legacyBlob?.incomeReceipts);
  const investments = asArray(payload.investments ?? legacyBlob?.investments);
  const loans = asArray(payload.loans ?? legacyBlob?.loans);
  const normalizedPlannedExpenses = plannedExpenses(payload.plannedExpenses ?? legacyBlob?.plannedExpenses);
  const normalizedNetWorthSnapshots = normalizeNetWorthSnapshots(
    payload.netWorthSnapshots ?? legacyBlob?.netWorthSnapshots,
  );
  const emergencyFund = normalizeEmergencyFund(
    payload.emergencyFund ?? legacyBlob?.emergencyFund,
    { ...(legacyBlob ?? {}), ...payload },
  );
  const lifestyleChoice = normalizeLifestyle(
    retirementInputs.lifestyleChoice ?? payload.lifestyleChoice ?? legacyBlob?.lifestyleChoice,
  );
  const customLifestyleExpense = asOptionalNonNegativeNumber(
    retirementInputs.customLifestyleExpense
      ?? payload.customLifestyleExpense
      ?? legacyBlob?.customLifestyleExpense,
  );
  const retirementSpendingAdjustmentPercent = Math.max(
    -90,
    Math.min(300, asNumber(
      retirementInputs.retirementSpendingAdjustmentPercent
        ?? payload.retirementSpendingAdjustmentPercent
        ?? legacyBlob?.retirementSpendingAdjustmentPercent,
      0,
    )),
  );
  const pensionSources = normalizePensionSources(
    retirementInputs.pensionSources ?? payload.pensionSources ?? legacyBlob?.pensionSources,
  );

  const targetRetirementAge = Math.round(
    asNumber(profileInputs.targetRetirementAge ?? retirementInputs.targetRetirementAge, 55),
  );
  const lifeExpectancy = Math.round(
    asNumber(profileInputs.lifeExpectancy ?? retirementInputs.lifeExpectancy, 85),
  );
  const riskPreference = asString(profileInputs.riskPreference, "Balanced") || "Balanced";
  const uiPreferences = normalizeUiPreferences(payload.uiPreferences);
  const progress = onboardingProgress(profileInputs.onboardingProgress);
  let planningData: PlanningDataWithReportDelivery = {
    plannedExpenses: normalizedPlannedExpenses,
    netWorthSnapshots: normalizedNetWorthSnapshots,
    emergencyFund,
    ...(lifestyleChoice ? { lifestyleChoice } : {}),
    ...(customLifestyleExpense !== undefined ? { customLifestyleExpense } : {}),
    retirementSpendingAdjustmentPercent,
    pensionSources,
    goals: normalizeGoals(payload.goals ?? legacyBlob?.goals),
    customReminders: normalizeReminders(payload.reminders ?? payload.customReminders
      ?? legacyBlob?.reminders ?? legacyBlob?.customReminders),
    notificationPreferences: normalizeNotificationPreferences(
      payload.notificationPreferences ?? legacyBlob?.notificationPreferences,
    ),
    notificationState: normalizeNotificationState(
      payload.notifications ?? payload.notificationState
        ?? legacyBlob?.notifications ?? legacyBlob?.notificationState,
    ),
    pushSubscriptions: normalizePushSubscriptions(
      payload.pushSubscriptions ?? legacyBlob?.pushSubscriptions,
    ),
    monthlyReportSnapshots: normalizeMonthlyReports(
      payload.monthlyReports ?? payload.monthlyReportSnapshots
        ?? legacyBlob?.monthlyReports ?? legacyBlob?.monthlyReportSnapshots,
    ),
    ...(progress ? { onboardingProgress: progress } : {}),
  };

  const generalInflationPct = money(retirementInputs.generalInflation, 6);
  const salaryGrowthPct = money(retirementInputs.salaryGrowth, 8);
  const contributionOverride = optionalMoney(retirementInputs.monthlyContributionOverride);
  const investSurplus = asBoolean(retirementInputs.investSurplus, false);
  const now = new Date();

  const loanRows = loans.filter(isRecord).map((loan) => ({
    id: rowId(loan.id),
    userId: user.id,
    type: asString(loan.type, "Other") || "Other",
    name: asString(loan.name),
    sanctionedPrincipal: money(loan.sanctionedPrincipal),
    outstandingPrincipal: money(loan.outstandingPrincipal),
    annualInterestRate: money(loan.annualInterestRate),
    interestType: asString(loan.interestType, "Floating") || "Floating",
    totalTenureMonths: Math.round(asNumber(loan.totalTenureMonths)),
    startDate: asString(loan.startDate),
    emi: money(loan.emi),
    repaymentType:
      loan.repaymentType === "bullet" || loan.repaymentType === "interest-only-plus-bullet"
        ? loan.repaymentType
        : "emi",
    prepayments: money(loan.prepayments),
    notes: asString(loan.notes),
    createdAt: loan.createdAt ? new Date(asString(loan.createdAt)) : now,
  }));
  const loanIds = new Set(loanRows.map((loan) => loan.id));

  const incomeRows = incomeSources.filter(isRecord).map((source) => {
    const salaryDetails = isRecord(source.salaryDetails)
      ? normalizedSalaryDetails(source.salaryDetails)
      : undefined;
    const legacyAnnualSalary = isLegacyAnnualSalary(
      source.type,
      source.frequency,
      source.recurring,
      salaryDetails,
    );
    const frequency = legacyAnnualSalary
      ? "Monthly"
      : normalizedIncomeFrequency(source.frequency, source.recurring);
    const recurring = frequency !== "One-time";
    const endSchedule = incomeEndSchedule(source.incomeEndMode, source.incomeEndDate, recurring, frequency);
    return ({
    id: rowId(source.id),
    userId: user.id,
    name: asString(source.name),
    type: asString(source.type, "Other") || "Other",
    frequency,
    amount: money(legacyAnnualSalary ? asNumber(source.amount) / 12 : source.amount),
    date: asString(source.date),
    recurring,
    annualGrowthRate: recurring ? optionalMoney(source.annualGrowthRate) : null,
    incomeEndMode: endSchedule.incomeEndMode,
    incomeEndDate: endSchedule.incomeEndDate,
    notes: asString(source.notes),
    createdAt: source.createdAt ? new Date(asString(source.createdAt)) : now,
    salaryDetails: legacyAnnualSalary && salaryDetails
      ? monthlySalaryDetails(salaryDetails)
      : salaryDetails,
    });
  });
  const incomeIds = new Set(incomeRows.map((source) => source.id));
  const incomeReceiptRows = incomeReceipts.filter(isRecord).flatMap((receipt) => {
    const incomeSourceId = asString(receipt.incomeSourceId);
    const receivedDate = calendarDate(receipt.receivedDate);
    if (!incomeIds.has(incomeSourceId) || !receivedDate) return [];
    return [{
      id: rowId(receipt.id),
      userId: user.id,
      incomeSourceId,
      receivedDate,
      amount: money(Math.max(0, asNumber(receipt.amount))),
      note: asString(receipt.note),
      createdAt: receipt.createdAt ? new Date(asString(receipt.createdAt)) : now,
    }];
  });
  const incomeById = new Map(incomeRows.map((source) => [source.id, source]));
  const allocationTotals = new Map<string, number>();
  const allocationIds = new Set<string>();
  const validatedStoredFundAllocations = (value: unknown) =>
    fundAllocations(value).filter((allocation) => {
      if (allocationIds.has(allocation.id)) return false;
      const source = incomeById.get(allocation.sourceId);
      const opportunityDate = calendarDate(allocation.opportunityDate);
      const investmentDate = calendarDate(allocation.investmentDate);
      if (!source || !opportunityDate || !investmentDate || investmentDate < opportunityDate) return false;
      const isAnnual = source.recurring && source.frequency === "Annual";
      const validOccurrence = isAnnual
        ? annualOccurrence(source.date, opportunityDate)
          && (!source.incomeEndDate || opportunityDate.slice(0, 7) <= source.incomeEndDate.slice(0, 7))
        : source.frequency !== "Monthly" && calendarDate(source.date) === opportunityDate;
      if (!validOccurrence) return false;
      const details = isRecord(source.salaryDetails) ? source.salaryDetails : undefined;
      const baseAvailable = source.type === "Salary" && details
        ? Math.max(
            0,
            asNumber(details.basicPay) + asNumber(details.hra) + asNumber(details.allowances)
              - asNumber(details.employeePF) - asNumber(details.professionalTax)
              - asNumber(details.tds) - asNumber(details.otherDeductions),
          )
        : asNumber(source.amount);
      const [anchorYear] = (calendarDate(source.date) ?? "0").split("-").map(Number);
      const [opportunityYear] = opportunityDate.split("-").map(Number);
      const annualGrowthRate = isAnnual
        ? Math.min(
            0.5,
            Math.max(
              0,
              asNumber(
                source.annualGrowthRate,
                source.type === "Salary" ? asNumber(salaryGrowthPct) : 0,
              ) / 100,
            ),
          )
        : 0;
      const available = baseAvailable * Math.pow(
        1 + annualGrowthRate,
        Math.max(0, opportunityYear - anchorYear),
      );
      const key = `${source.id}:${opportunityDate}`;
      const nextTotal = (allocationTotals.get(key) ?? 0) + allocation.amount;
      if (nextTotal > available + 0.005) return false;
      allocationIds.add(allocation.id);
      allocationTotals.set(key, nextTotal);
      return true;
    });

  const salaryRows: SalaryRow[] = incomeRows
    .filter((row) => row.salaryDetails)
    .map((row) => ({
      incomeSourceId: row.id,
      grossCtc: money(row.salaryDetails?.grossCTC),
      grossCtcMode: salaryMode(row.salaryDetails?.grossCTCMode),
      basicPay: money(row.salaryDetails?.basicPay),
      hra: money(row.salaryDetails?.hra),
      allowances: money(row.salaryDetails?.allowances),
      employeePf: money(row.salaryDetails?.employeePF),
      professionalTax: money(row.salaryDetails?.professionalTax),
      tds: money(row.salaryDetails?.tds),
      tdsMode: salaryMode(row.salaryDetails?.tdsMode),
      taxRegime:
        row.salaryDetails?.taxRegime === "new" || row.salaryDetails?.taxRegime === "old"
          ? row.salaryDetails.taxRegime
          : null,
      financialYear: asString(row.salaryDetails?.financialYear) || null,
      taxRuleVersion: asString(row.salaryDetails?.taxRuleVersion) || null,
      otherDeductions: money(row.salaryDetails?.otherDeductions),
    }));

  let expenseRows = expenses.filter(isRecord).map((expense) => ({
    id: rowId(expense.id),
    userId: user.id,
    loanId:
      typeof expense.linkedLoanId === "string" && loanIds.has(expense.linkedLoanId)
        ? expense.linkedLoanId
        : null,
    date: asString(expense.date),
    amount: money(expense.amount),
    category: asString(expense.category),
    merchant: asString(expense.merchant),
    paymentMethod: asString(expense.paymentMethod),
    note: asString(expense.note),
    reimbursable: asBoolean(expense.reimbursable),
    recurring: asBoolean(expense.recurring),
    createdAt: expense.createdAt ? new Date(asString(expense.createdAt)) : now,
  }));

  const budgetRows = budgets
    .filter(isRecord)
    .map((budget) => {
      const schedules = budgetSchedules(
        budget.schedules ?? budget.windows ?? budget.budgetWindows,
      );
      return {
        id: rowId(budget.id),
        userId: user.id,
        category: asString(budget.category),
        monthlyLimit: money(budget.monthlyLimit),
        details: schedules.length > 0 ? { schedules } : {},
      };
    })
    .filter((budget) => budget.category);

  const investmentRows = investments.filter(isRecord).map((investment) => {
    const storedFundAllocations = validatedStoredFundAllocations(investment.fundAllocations);
    const investmentId = rowId(investment.id);
    const storedDisposals = investmentDisposals(investment.disposals, investmentId);
    return ({
    id: investmentId,
    userId: user.id,
    linkedIncomeSourceId:
      typeof investment.linkedIncomeSourceId === "string"
      && incomeIds.has(investment.linkedIncomeSourceId)
        ? investment.linkedIncomeSourceId
        : null,
    name: asString(investment.name),
    assetClass: asString(investment.assetClass, "Other") || "Other",
    investedAmount: money(investment.investedAmount),
    currentValue: money(investment.currentValue),
    quantity: optionalMoney(investment.quantity),
    averageBuyPrice: optionalMoney(investment.averageBuyPrice),
    monthlyContribution: optionalMoney(investment.monthlyContribution),
    contributionStartDate: asString(investment.contributionStartDate) || formatDateOnly(now),
    contributionEndMode:
      investment.contributionEndMode === "custom" ? "custom" : "retirement",
    contributionEndDate:
      investment.contributionEndMode === "custom"
        ? asString(investment.contributionEndDate) || null
        : null,
    autoManagedContribution: asBoolean(investment.autoManagedContribution),
    expectedReturn: money(investment.expectedReturn),
    ticker: asString(investment.ticker) || null,
    folio: asString(investment.folio) || null,
    institution: asString(investment.institution) || null,
    interestRate: optionalMoney(investment.interestRate),
    accountNumber: asString(investment.accountNumber) || null,
    maturityDate: asString(investment.maturityDate) || null,
    notes: asString(investment.notes),
    details: {
      ...(typeof investment.unit === "string" ? { unit: investment.unit } : {}),
      ...(typeof investment.location === "string" ? { location: investment.location } : {}),
      ...(typeof investment.area === "string" ? { area: investment.area } : {}),
      ...(storedFundAllocations.length > 0
        ? { fundAllocations: storedFundAllocations }
        : {}),
      ...(storedDisposals.length > 0 ? { disposals: storedDisposals } : {}),
    },
    createdAt: investment.createdAt ? new Date(asString(investment.createdAt)) : now,
    });
  });

  // Timestamp columns hold IST wall clock time, which the schema's column type
  // applies on the way to the driver. Raw SQL skips that, so these statements
  // use the database clock rather than sending one from the application.
  const istNow = sql`timezone('Asia/Kolkata', now())`;

  let finalExpenseRows = expenseRows;
  let responseUser = user;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${financialLifecycleLockKey(user.id)}))`);
    const admissionBaseline = await captureCanonicalAdmissionBaseline(tx, user);
    let preservedBankImportProvenance: Array<typeof bankStatementImportProvenanceTable.$inferSelect> = [];
    if (accountMutation) {
      const [currentAccount] = await tx.select({ phone: usersTable.phone }).from(usersTable)
        .where(eq(usersTable.id, user.id)).for("update");
      if (!currentAccount) throw new Error("Account not found");
      const phoneChanged = accountMutation.phone !== undefined
        && accountMutation.phone !== currentAccount.phone;
      if (phoneChanged) {
        await tx.update(mobileOtpChallengesTable).set({ consumedAt: new Date() }).where(and(
          eq(mobileOtpChallengesTable.userId, user.id),
          isNull(mobileOtpChallengesTable.consumedAt),
        ));
      }
      const [updatedAccount] = await tx.update(usersTable).set({
        fullName: accountMutation.fullName,
        gender: accountMutation.gender,
        phone: accountMutation.phone,
        phoneVerifiedAt: phoneChanged ? null : undefined,
        dateOfBirth: accountMutation.dateOfBirth,
        onboardingCompleted: accountMutation.onboardingCompleted,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, user.id)).returning();
      if (!updatedAccount) throw new Error("Account not found");
      responseUser = updatedAccount;
    }
    await tx.insert(userProfilesTable).values({ userId: user.id }).onConflictDoNothing();
    await tx.execute(sql`select user_id from user_profiles where user_id = ${user.id} for update`);
    if (mode === "save") {
      const deletedReceiptExpenses = await tx.select({
        id: receiptReviewsTable.confirmedExpenseDeletedId,
      }).from(receiptReviewsTable).where(eq(receiptReviewsTable.userId, user.id));
      const deletedIds = new Set(deletedReceiptExpenses.flatMap(({ id }) => id ? [id] : []));
      expenseRows = expenseRows.filter(({ id }) => !deletedIds.has(id));
      const activeReceiptExpenses = await tx.select({
        id: receiptReviewsTable.confirmedExpenseId,
      }).from(receiptReviewsTable).where(and(
        eq(receiptReviewsTable.userId, user.id),
        isNotNull(receiptReviewsTable.confirmedExpenseId),
      ));
      const submittedIds = new Set(expenseRows.map(({ id }) => id));
      const omittedProtectedIds = activeReceiptExpenses.flatMap(({ id }) =>
        id && !submittedIds.has(id) ? [id] : []);
      if (omittedProtectedIds.length > 0) {
        const omittedProtectedExpenses = await tx.select().from(expensesTable).where(and(
          eq(expensesTable.userId, user.id),
          inArray(expensesTable.id, omittedProtectedIds),
        ));
        // Submitted rows retain precedence and order. Only protected rows that
        // SQL will retain despite omission are appended to the replacement set.
        expenseRows = [...expenseRows, ...omittedProtectedExpenses];
      }
    } else {
      const restoredExpenseIds = new Set(expenseRows.map(({ id }) => id));
      const activeReceiptExpenses = await tx.select({
        reviewId: receiptReviewsTable.id,
        expenseId: receiptReviewsTable.confirmedExpenseId,
      }).from(receiptReviewsTable).where(and(
        eq(receiptReviewsTable.userId, user.id),
        isNotNull(receiptReviewsTable.confirmedExpenseId),
      )).for("update");
      const deletedAt = new Date();
      for (const receipt of activeReceiptExpenses) {
        if (receipt.expenseId && !restoredExpenseIds.has(receipt.expenseId)) {
          await tx.update(receiptReviewsTable).set({
            confirmedExpenseDeletedId: receipt.expenseId,
            confirmedExpenseDeletedAt: deletedAt,
            confirmedExpenseId: null,
          }).where(and(
            eq(receiptReviewsTable.id, receipt.reviewId),
            eq(receiptReviewsTable.userId, user.id),
            eq(receiptReviewsTable.confirmedExpenseId, receipt.expenseId),
          ));
        }
      }
    }
    const retainedExpenseIds = [...new Set(expenseRows.map(({ id }) => id))];
    if (retainedExpenseIds.length > 0) {
      preservedBankImportProvenance = await tx.select()
        .from(bankStatementImportProvenanceTable)
        .where(and(
          eq(bankStatementImportProvenanceTable.userId, user.id),
          inArray(bankStatementImportProvenanceTable.expenseId, retainedExpenseIds),
        ))
        .for("update");
    }
    const [existingProfile] = await tx
      .select({ planningData: userProfilesTable.planningData })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, user.id))
      .limit(1);
    const existingPlanning = (isRecord(existingProfile?.planningData)
      ? existingProfile.planningData
      : {}) as PlanningDataWithReportDelivery;
    planningData = {
      ...planningData,
      goals: payload.goals === undefined ? normalizeGoals(existingPlanning.goals) : planningData.goals,
      customReminders: payload.reminders === undefined && payload.customReminders === undefined
        ? normalizeReminders(existingPlanning.customReminders)
        : planningData.customReminders,
      notificationPreferences: payload.notificationPreferences === undefined
        ? normalizeNotificationPreferences(existingPlanning.notificationPreferences)
        : planningData.notificationPreferences,
      notificationState: payload.notifications === undefined && payload.notificationState === undefined
        ? normalizeNotificationState(existingPlanning.notificationState)
        : mergeNotificationState(existingPlanning.notificationState, planningData.notificationState),
      // Subscriptions and immutable snapshots are server-owned and can only be
      // changed through their dedicated authenticated endpoints.
      pushSubscriptions: normalizePushSubscriptions(existingPlanning.pushSubscriptions),
      monthlyReportSnapshots: mode === "restore"
        ? planningData.monthlyReportSnapshots
        : normalizeMonthlyReports(existingPlanning.monthlyReportSnapshots),
      monthlyReportEmailDeliveries: isRecord(existingPlanning.monthlyReportEmailDeliveries)
        ? existingPlanning.monthlyReportEmailDeliveries
        : {},
      monthlyReportEmailFailures: normalizeMonthlyReportEmailFailures(
        existingPlanning.monthlyReportEmailFailures,
      ),
    };
    // This check deliberately happens after the profile row lock is acquired
    // and before any destructive replacement statements.  Both the dedicated
    // goals endpoint and a complete document save therefore share the same
    // authoritative concurrency boundary.
    const previousGoals = normalizeGoals(existingPlanning.goals);
    const previousCommitment = previousGoals.reduce(
      (sum, goal) => sum + goal.monthlyAllocation, 0,
    );
    const nextCommitment = (planningData.goals ?? []).reduce(
      (sum, goal) => sum + goal.monthlyAllocation, 0,
    );
    const increasesGoalCommitment = payload.goals !== undefined
      && nextCommitment > previousCommitment + 0.005;
    if (mode === "save" && increasesGoalCommitment) {
      assertGoalAllocationsWithinSurplus(planningData.goals ?? [], {
        income: incomeRows,
        budgets: budgetRows,
        expenses: expenseRows,
        loans: loanRows,
        investments: investmentRows,
        emergencyFund: planningData.emergencyFund,
      });
    }
    // Profile and plan upserts travel together as one statement.
    await tx.execute(sql`
      with saved_profile as (
        insert into user_profiles (user_id, risk_preference, ui_preferences, planning_data, updated_at)
        values (${user.id}, ${riskPreference}, cast(${JSON.stringify(uiPreferences)} as jsonb), cast(${JSON.stringify(planningData)} as jsonb), ${istNow})
        on conflict (user_id) do update
          set risk_preference = excluded.risk_preference,
              ui_preferences = excluded.ui_preferences,
              planning_data = excluded.planning_data,
              updated_at = excluded.updated_at
      )
      insert into retirement_plans (
        user_id,
        target_retirement_age,
        life_expectancy,
        general_inflation_pct,
        salary_growth_pct,
        monthly_contribution_override,
        invest_surplus,
        updated_at
      )
      values (
        ${user.id},
        ${targetRetirementAge},
        ${lifeExpectancy},
        ${generalInflationPct},
        ${salaryGrowthPct},
        ${contributionOverride},
        ${investSurplus},
        ${istNow}
      )
      on conflict (user_id) do update
        set target_retirement_age = excluded.target_retirement_age,
            life_expectancy = excluded.life_expectancy,
            general_inflation_pct = excluded.general_inflation_pct,
            salary_growth_pct = excluded.salary_growth_pct,
            monthly_contribution_override = excluded.monthly_contribution_override,
            invest_surplus = excluded.invest_surplus,
            updated_at = excluded.updated_at
    `);

    // One statement instead of five. Each round trip to the database costs the
    // full network latency, which dominates the time a save takes.
    await tx.execute(sql`
      with
        cleared_investments as (delete from investments where user_id = ${user.id}),
        cleared_expenses as (
          delete from expenses e
          where e.user_id = ${user.id}
            and not exists (
              select 1 from receipt_reviews r
              where r.user_id = ${user.id}
                and r.confirmed_expense_id = e.id
            )
        ),
        cleared_budgets as (delete from budgets where user_id = ${user.id}),
        cleared_income as (delete from income_sources where user_id = ${user.id}),
        cleared_loans as (delete from loans where user_id = ${user.id})
      select 1
    `);

    // Loans and income go first: expenses and investments reference them.
    for (const chunk of rowChunks(loanRows)) await tx.insert(loansTable).values(chunk);
    if (incomeRows.length > 0) {
      const storedIncomeRows = incomeRows.map(({ salaryDetails: _salary, ...row }) => row);
      for (const chunk of rowChunks(storedIncomeRows)) {
        await tx.insert(incomeSourcesTable).values(chunk);
      }
      for (const chunk of rowChunks(salaryRows)) {
        await tx.insert(salaryDetailsTable).values(chunk);
      }
      for (const chunk of rowChunks(incomeReceiptRows)) {
        await tx.insert(incomeReceiptsTable).values(chunk);
      }
    }
    if (expenseRows.length > 0) {
      for (const chunk of rowChunks(expenseRows)) {
        await tx.insert(expensesTable).values(chunk).onConflictDoUpdate({
          target: expensesTable.id,
          set: {
            loanId: sql`excluded.loan_id`,
            date: sql`excluded.date`,
            amount: sql`excluded.amount`,
            category: sql`excluded.category`,
            merchant: sql`excluded.merchant`,
            paymentMethod: sql`excluded.payment_method`,
            note: sql`excluded.note`,
            reimbursable: sql`excluded.reimbursable`,
            recurring: sql`excluded.recurring`,
            updatedAt: new Date(),
          },
          setWhere: eq(expensesTable.userId, user.id),
        });
      }
      if (mode === "restore") {
        const requestedExpenseIds = [...new Set(expenseRows.map(({ id }) => id))];
        const materializedExpenses = await tx.select({ id: expensesTable.id })
          .from(expensesTable).where(and(
            eq(expensesTable.userId, user.id),
            inArray(expensesTable.id, requestedExpenseIds),
          ));
        if (materializedExpenses.length !== requestedExpenseIds.length) {
          throw new FinancialRestoreCollisionError();
        }
        await tx.update(receiptReviewsTable).set({
          confirmedExpenseId: receiptReviewsTable.confirmedExpenseDeletedId,
          confirmedExpenseDeletedId: null,
          confirmedExpenseDeletedAt: null,
        }).where(and(
          eq(receiptReviewsTable.userId, user.id),
          inArray(receiptReviewsTable.confirmedExpenseDeletedId, expenseRows.map(({ id }) => id)),
          sql`exists (
            select 1
            from expenses restore_expense
            where restore_expense.id = ${receiptReviewsTable.confirmedExpenseDeletedId}
              and restore_expense.user_id = ${user.id}
          )`,
        ));
      }
      if (preservedBankImportProvenance.length > 0) {
        for (const chunk of rowChunks(preservedBankImportProvenance)) {
          await tx.insert(bankStatementImportProvenanceTable)
            .values(chunk)
            .onConflictDoNothing();
        }
      }
    }
    for (const chunk of rowChunks(budgetRows)) await tx.insert(budgetsTable).values(chunk);
    for (const chunk of rowChunks(investmentRows)) {
      await tx.insert(investmentsTable).values(chunk);
    }
    finalExpenseRows = await tx.select().from(expensesTable)
      .where(eq(expensesTable.userId, user.id));
    await assertCanonicalMutationAdmission(
      tx,
      responseUser,
      admissionBaseline,
      financialDocumentAdmissionLimit,
    );
  });

  // The rows above are exactly what the database now holds, so the response is
  // built from them rather than spending another round trip reading them back.
  return buildFinancialData(responseUser, {
    profile: { riskPreference, uiPreferences, planningData },
    plan: {
      targetRetirementAge,
      lifeExpectancy,
      generalInflationPct,
      salaryGrowthPct,
      monthlyContributionOverride: contributionOverride,
      investSurplus,
    },
    expenses: finalExpenseRows,
    budgets: budgetRows,
    incomeSources: incomeRows,
    incomeReceipts: incomeReceiptRows,
    salary: salaryRows,
    investments: investmentRows,
    loans: loanRows,
  });
}

export async function restoreFinancialData(
  user: typeof usersTable.$inferSelect,
  payload: Record<string, unknown>,
  accountMutation: FinancialRestoreAccountMutation,
  financialDocumentAdmissionLimit = FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT,
): Promise<{
  data: FinancialDataResponse;
  user: typeof usersTable.$inferSelect;
}> {
  const data = await saveFinancialData(
    user,
    payload,
    undefined,
    "restore",
    accountMutation,
    financialDocumentAdmissionLimit,
  );
  const [updatedUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!updatedUser) throw new Error("Account not found after restore");
  return { data, user: updatedUser };
}

export async function clearFinancialData(
  user: typeof usersTable.$inferSelect,
): Promise<FinancialDataResponse> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${financialLifecycleLockKey(user.id)}))`);
    const admissionBaseline = await captureCanonicalAdmissionBaseline(tx, user);
    const now = new Date();
    await tx.update(receiptReviewsTable).set({
      confirmedExpenseDeletedId: receiptReviewsTable.confirmedExpenseId,
      confirmedExpenseDeletedAt: now,
      confirmedExpenseId: null,
    }).where(and(
      eq(receiptReviewsTable.userId, user.id),
      isNotNull(receiptReviewsTable.confirmedExpenseId),
    ));
    await tx.execute(sql`
    with
      cleared_investments as (delete from investments where user_id = ${user.id}),
      cleared_expenses as (
        delete from expenses e
        where e.user_id = ${user.id}
          and not exists (
            select 1 from receipt_reviews r
            where r.user_id = ${user.id}
              and r.confirmed_expense_id = e.id
          )
      ),
      cleared_budgets as (delete from budgets where user_id = ${user.id}),
      cleared_income as (delete from income_sources where user_id = ${user.id}),
      cleared_loans as (delete from loans where user_id = ${user.id}),
      cleared_plan as (delete from retirement_plans where user_id = ${user.id}),
      cleared_profile as (delete from user_profiles where user_id = ${user.id})
    select 1
    `);
    await assertCanonicalMutationAdmission(tx, user, admissionBaseline);
  });
  return buildFinancialData(user, {
    profile: undefined,
    plan: undefined,
    expenses: [],
    budgets: [],
    incomeSources: [],
    incomeReceipts: [],
    salary: [],
    investments: [],
    loans: [],
  });
}

export async function deleteFinancialExpense(
  user: typeof usersTable.$inferSelect,
  expenseId: string,
): Promise<FinancialDataResponse | null> {
  const deleted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${financialLifecycleLockKey(user.id)}))`);
    const admissionBaseline = await captureCanonicalAdmissionBaseline(tx, user);
    const [expense] = await tx.select({ id: expensesTable.id }).from(expensesTable)
      .where(sql`${expensesTable.id} = ${expenseId} and ${expensesTable.userId} = ${user.id}`)
      .for("update");
    if (!expense) return false;
    const now = new Date();
    await tx.update(receiptReviewsTable).set({
      confirmedExpenseDeletedId: expense.id,
      confirmedExpenseDeletedAt: now,
      confirmedExpenseId: null,
    }).where(sql`${receiptReviewsTable.userId} = ${user.id}
      and ${receiptReviewsTable.confirmedExpenseId} = ${expense.id}`);
    await tx.delete(expensesTable).where(sql`${expensesTable.id} = ${expense.id}
      and ${expensesTable.userId} = ${user.id}`);
    await assertCanonicalMutationAdmission(tx, user, admissionBaseline);
    return true;
  });
  return deleted ? loadFinancialData(user) : null;
}
