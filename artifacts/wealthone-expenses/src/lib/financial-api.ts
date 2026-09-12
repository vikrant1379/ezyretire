import { defaultNotificationPreferences, formatDateOnly, normalizeBudgets, normalizeGoals, normalizeIncomeSchedule, normalizeInvestmentContributionSchedule, normalizeMonthlyReports, normalizeNotificationItems, normalizeNotificationPreferences, normalizeReminders, type Budget, type EmergencyFundPlan, type Expense, type FinancialGoal, type FinancialReminder, type IncomeReceipt, type IncomeSource, type Investment, type Loan, type MonthlyReportSnapshot, type NetWorthSnapshot, type NotificationItem, type NotificationPreferences, type PensionSource, type PlannedExpense, type ProfileInputs, type RetirementInputs, type RetirementLifestyle } from "./storage.ts";
import {
  defaultUiPreferences,
  normalizeUiPreferences,
  type UiPreferences,
} from "./card-order.ts";

export type FinancialData = {
  expenses: Expense[];
  budgets: Budget[];
  incomeSources: IncomeSource[];
  incomeReceipts: IncomeReceipt[];
  investments: Investment[];
  loans: Loan[];
  plannedExpenses: PlannedExpense[];
  goals: FinancialGoal[];
  reminders: FinancialReminder[];
  notificationPreferences: NotificationPreferences;
  notifications: NotificationItem[];
  monthlyReports: MonthlyReportSnapshot[];
  monthlyReportEmailFailures: Record<string, MonthlyReportEmailFailure>;
  monthlyReportEmailStatusPendingMonths: string[];
  netWorthSnapshots: NetWorthSnapshot[];
  emergencyFund: EmergencyFundPlan;
  retirementInputs: RetirementInputs;
  profileInputs: ProfileInputs;
  uiPreferences: UiPreferences;
};

export type MonthlyReportEmailFailure = {
  category: "report_too_large" | "email_unavailable" | "temporary";
  failedAt: string;
};

export type FinancialHealthPlanningUpdate = {
  emergencyFund?: EmergencyFundPlan;
  netWorthSnapshot?: NetWorthSnapshot;
};

export type BrowserPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime?: number;
};

export type WebPushConfiguration =
  | { supported: true; publicKey: string }
  | { supported: false };

export const FINANCIAL_ACCOUNT_SWITCH_ERROR_CODE = "FINANCIAL_ACCOUNT_SWITCH";

export class FinancialAccountSwitchError extends Error {
  readonly code = FINANCIAL_ACCOUNT_SWITCH_ERROR_CODE;

  constructor() {
    super("Your account changed before this could be saved. Switch to the correct account and try again.");
    this.name = "FinancialAccountSwitchError";
  }
}

export function isFinancialAccountSwitchError(
  error: unknown,
): error is FinancialAccountSwitchError {
  return (
    error instanceof FinancialAccountSwitchError ||
    (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === FINANCIAL_ACCOUNT_SWITCH_ERROR_CODE
    )
  );
}

function defaultDateOfBirth(): string {
  return formatDateOnly(new Date(Date.now() - 86400000 * 365 * 30));
}

function defaultFinancialData(): FinancialData {
  const dateOfBirth = defaultDateOfBirth();
  return {
    expenses: [],
    budgets: [],
    incomeSources: [],
    incomeReceipts: [],
    investments: [],
    loans: [],
    plannedExpenses: [],
    goals: [],
    reminders: [],
    notificationPreferences: defaultNotificationPreferences(),
    notifications: [],
    monthlyReports: [],
    monthlyReportEmailFailures: {},
    monthlyReportEmailStatusPendingMonths: [],
    netWorthSnapshots: [],
    emergencyFund: {
      targetMonths: 6,
      reserveBalance: 0,
      monthlyContribution: 0,
    },
    retirementInputs: {
      dateOfBirth,
      targetRetirementAge: 55,
      lifeExpectancy: 85,
      generalInflation: 6,
      salaryGrowth: 8,
      monthlyContributionOverride: 0,
      investSurplus: false,
    },
    profileInputs: {
      dateOfBirth,
      targetRetirementAge: 55,
      lifeExpectancy: 85,
      riskPreference: "Balanced",
      onboardingCompleted: false,
    },
    uiPreferences: defaultUiPreferences(),
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asNumber(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function optionalNonNegativeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function normalizeLifestyle(value: unknown): RetirementLifestyle | undefined {
  return value === "Basic" || value === "Comfortable" || value === "Premium" || value === "Custom"
    ? value
    : undefined;
}

function normalizePensionSources(value: unknown): PensionSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((source, index) => {
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const monthlyAmount = optionalNonNegativeNumber(source.monthlyAmount ?? source.amount);
    if (!name || monthlyAmount === undefined) return [];
    const id = typeof source.id === "string" && source.id.trim()
      ? source.id.trim()
      : `pension-${index + 1}`;
    const startAge = optionalNonNegativeNumber(source.startAge);
    return [{
      id,
      name,
      monthlyAmount,
      ...(startAge !== undefined ? { startAge: Math.round(startAge) } : {}),
      annualEscalationRate:
        optionalNonNegativeNumber(source.annualEscalationRate ?? source.escalationRate) ?? 0,
    }];
  });
}

function normalizeNetWorthSnapshots(value: unknown): NetWorthSnapshot[] {
  if (!Array.isArray(value)) return [];
  const byMonth = new Map<string, NetWorthSnapshot>();
  value.filter(isRecord).forEach((snapshot) => {
    const month = typeof snapshot.month === "string"
      ? snapshot.month.trim().match(/^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/)?.[0].slice(0, 7)
      : undefined;
    const assets = optionalNonNegativeNumber(snapshot.assets);
    const liabilities = optionalNonNegativeNumber(snapshot.liabilities);
    if (!month || assets === undefined || liabilities === undefined) return;
    byMonth.set(month, {
      month,
      assets,
      liabilities,
      netWorth: assets - liabilities,
      ...(optionalNonNegativeNumber(snapshot.healthScore) !== undefined
        ? { healthScore: Math.min(100, optionalNonNegativeNumber(snapshot.healthScore)!) }
        : {}),
    });
  });
  return [...byMonth.values()].sort((left, right) => left.month.localeCompare(right.month));
}

function asRiskPreference(value: unknown, fallback: ProfileInputs["riskPreference"]): ProfileInputs["riskPreference"] {
  return value === "Conservative" || value === "Balanced" || value === "Growth"
    ? value
    : fallback;
}

function normalizeFinancialData(payload: unknown): FinancialData {
  const defaults = defaultFinancialData();
  const value =
    typeof payload === "object" && payload !== null
      ? payload as Record<string, unknown>
      : {};
  const rawRetirement =
    typeof value.retirementInputs === "object" && value.retirementInputs !== null
      ? value.retirementInputs as Record<string, unknown>
      : {};
  const rawProfile =
    typeof value.profileInputs === "object" && value.profileInputs !== null
      ? value.profileInputs as Record<string, unknown>
      : {};
  const rawEmergency = isRecord(value.emergencyFund) ? value.emergencyFund : {};
  const dateOfBirth = asString(
    rawProfile.dateOfBirth ?? rawRetirement.dateOfBirth,
    defaults.profileInputs.dateOfBirth,
  );

  return {
    expenses: asArray<Expense>(value.expenses),
    budgets: normalizeBudgets(value.budgets),
    incomeSources: asArray<IncomeSource>(value.incomeSources).map(normalizeIncomeSchedule),
    incomeReceipts: asArray<IncomeReceipt>(value.incomeReceipts),
    investments: asArray<Investment>(value.investments).map((investment) =>
      normalizeInvestmentContributionSchedule(investment),
    ),
    loans: asArray<Loan>(value.loans),
    plannedExpenses: asArray<PlannedExpense>(value.plannedExpenses),
    goals: normalizeGoals(value.goals),
    reminders: normalizeReminders(value.reminders),
    notificationPreferences: normalizeNotificationPreferences(value.notificationPreferences),
    notifications: normalizeNotificationItems(value.notifications),
    monthlyReports: normalizeMonthlyReports(value.monthlyReports),
    monthlyReportEmailFailures: normalizeMonthlyReportEmailFailures(value.monthlyReportEmailFailures),
    monthlyReportEmailStatusPendingMonths: asArray<unknown>(
      value.monthlyReportEmailStatusPendingMonths,
    ).filter((month): month is string =>
      typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)),
    netWorthSnapshots: normalizeNetWorthSnapshots(value.netWorthSnapshots),
    emergencyFund: {
      targetMonths: optionalNonNegativeNumber(
        rawEmergency.targetMonths ?? value.emergencyTargetMonths,
      ) ?? defaults.emergencyFund.targetMonths,
      reserveBalance: optionalNonNegativeNumber(
        rawEmergency.reserveBalance ?? value.emergencyReserveBalance,
      ) ?? defaults.emergencyFund.reserveBalance,
      monthlyContribution: optionalNonNegativeNumber(
        rawEmergency.monthlyContribution ?? value.emergencyMonthlyContribution,
      ) ?? defaults.emergencyFund.monthlyContribution,
    },
    retirementInputs: {
      dateOfBirth,
      targetRetirementAge: asNumber(
        rawRetirement.targetRetirementAge ?? rawProfile.targetRetirementAge,
        defaults.retirementInputs.targetRetirementAge,
      ),
      lifeExpectancy: asNumber(
        rawRetirement.lifeExpectancy ?? rawProfile.lifeExpectancy,
        defaults.retirementInputs.lifeExpectancy,
      ),
      generalInflation: asNumber(
        rawRetirement.generalInflation,
        defaults.retirementInputs.generalInflation,
      ),
      salaryGrowth: asNumber(rawRetirement.salaryGrowth, defaults.retirementInputs.salaryGrowth),
      monthlyContributionOverride:
        rawRetirement.monthlyContributionOverride === undefined
          ? defaults.retirementInputs.monthlyContributionOverride
          : asNumber(
              rawRetirement.monthlyContributionOverride,
              defaults.retirementInputs.monthlyContributionOverride ?? 0,
            ),
      investSurplus: asBoolean(
        rawRetirement.investSurplus,
        defaults.retirementInputs.investSurplus ?? false,
      ),
      lifestyleChoice: normalizeLifestyle(
        rawRetirement.lifestyleChoice ?? value.lifestyleChoice,
      ),
      customLifestyleExpense: optionalNonNegativeNumber(
        rawRetirement.customLifestyleExpense ?? value.customLifestyleExpense,
      ),
      retirementSpendingAdjustmentPercent: asNumber(
        rawRetirement.retirementSpendingAdjustmentPercent,
        defaults.retirementInputs.retirementSpendingAdjustmentPercent ?? 0,
      ),
      pensionSources: normalizePensionSources(
        rawRetirement.pensionSources ?? value.pensionSources,
      ),
    },
    profileInputs: {
      fullName: typeof rawProfile.fullName === "string" ? rawProfile.fullName : undefined,
      gender: typeof rawProfile.gender === "string" ? rawProfile.gender : undefined,
      email: typeof rawProfile.email === "string" ? rawProfile.email : undefined,
      phone: typeof rawProfile.phone === "string" ? rawProfile.phone : undefined,
      onboardingCompleted: asBoolean(
        rawProfile.onboardingCompleted,
        defaults.profileInputs.onboardingCompleted ?? false,
      ),
      onboardingProgress:
        typeof rawProfile.onboardingProgress === "object" && rawProfile.onboardingProgress !== null
          ? rawProfile.onboardingProgress as ProfileInputs["onboardingProgress"]
          : undefined,
      dateOfBirth,
      targetRetirementAge: asNumber(
        rawProfile.targetRetirementAge ?? rawRetirement.targetRetirementAge,
        defaults.profileInputs.targetRetirementAge,
      ),
      lifeExpectancy: asNumber(
        rawProfile.lifeExpectancy ?? rawRetirement.lifeExpectancy,
        defaults.profileInputs.lifeExpectancy,
      ),
      riskPreference: asRiskPreference(
        rawProfile.riskPreference,
        defaults.profileInputs.riskPreference,
      ),
    },
    uiPreferences: normalizeUiPreferences(value.uiPreferences),
  };
}

function normalizeMonthlyReportEmailFailures(value: unknown): Record<string, MonthlyReportEmailFailure> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([month, failure]) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !isRecord(failure)) return [];
    const category = failure.category;
    const failedAt = typeof failure.failedAt === "string" ? failure.failedAt : "";
    if (
      (category !== "report_too_large" && category !== "email_unavailable" && category !== "temporary")
      || !Number.isFinite(new Date(failedAt).getTime())
    ) return [];
    return [[month, { category, failedAt }]];
  }));
}

async function request<T>(
  path: string,
  init?: RequestInit,
  fallback?: T,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
  });
  if (response.status === 401 && fallback !== undefined) {
    return fallback;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Unable to load financial data");
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error("The server returned an empty or invalid financial data response. Please try again.");
  }
}

type FinancialDataGeneration = {
  latestKnownData: FinancialData | null;
  writeQueue: Promise<unknown>;
  reconciliationEpoch: number;
  mustReconcile: boolean;
};

function newFinancialDataGeneration(): FinancialDataGeneration {
  return {
    latestKnownData: null,
    writeQueue: Promise.resolve(),
    reconciliationEpoch: 0,
    mustReconcile: false,
  };
}

export class StaleFinancialReplacementError extends Error {
  constructor() {
    super("Financial data changed while this save was waiting. Review the latest data and retry.");
    this.name = "StaleFinancialReplacementError";
  }
}

export class UncertainExternalFinancialMutationError extends Error {
  readonly reconciledData: FinancialData | null;

  constructor(
    message: string,
    reconciledData: FinancialData | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "UncertainExternalFinancialMutationError";
    this.reconciledData = reconciledData;
  }
}

async function reconcileGeneration(
  generation: FinancialDataGeneration,
  fallback?: FinancialData,
): Promise<FinancialData> {
  assertActiveGeneration(generation);
  const payload = await request<unknown>("/api/financial-data", undefined, fallback);
  assertActiveGeneration(generation);
  const data = normalizeFinancialData(payload);
  generation.latestKnownData = data;
  generation.mustReconcile = false;
  generation.reconciliationEpoch += 1;
  return data;
}

async function ensureGenerationData(generation: FinancialDataGeneration): Promise<FinancialData> {
  if (generation.mustReconcile || !generation.latestKnownData) {
    return reconcileGeneration(generation);
  }
  return generation.latestKnownData;
}

async function performCanonicalFinancialMutation(
  generation: FinancialDataGeneration,
  mutation: () => Promise<unknown>,
  uncertainMessage: string,
): Promise<FinancialData> {
  if (generation.mustReconcile) await reconcileGeneration(generation);
  assertActiveGeneration(generation);
  try {
    const payload = await mutation();
    assertActiveGeneration(generation);
    const data = normalizeFinancialData(payload);
    generation.latestKnownData = data;
    generation.mustReconcile = false;
    generation.reconciliationEpoch += 1;
    return data;
  } catch (error) {
    if (isFinancialAccountSwitchError(error)) throw error;
    assertActiveGeneration(generation);
    generation.latestKnownData = null;
    generation.mustReconcile = true;
    generation.reconciliationEpoch += 1;
    let reconciledData: FinancialData | null = null;
    try {
      reconciledData = await reconcileGeneration(generation);
    } catch (reconciliationError) {
      if (isFinancialAccountSwitchError(reconciliationError)) throw reconciliationError;
    }
    throw new UncertainExternalFinancialMutationError(
      error instanceof Error ? error.message : uncertainMessage,
      reconciledData,
      { cause: error },
    );
  }
}

/**
 * Keeping both the cache and queue on the authenticated account generation
 * prevents queued work from crossing an account boundary.
 */
let activeGeneration = newFinancialDataGeneration();
let activeAccountId: string | null | undefined;

function assertActiveGeneration(generation: FinancialDataGeneration): void {
  if (generation !== activeGeneration) {
    throw new FinancialAccountSwitchError();
  }
}

export function activateFinancialDataAccount(accountId: string | null): void {
  if (activeAccountId === accountId) {
    return;
  }
  activeAccountId = accountId;
  activeGeneration = newFinancialDataGeneration();
}

function enqueueWrite<T>(
  generation: FinancialDataGeneration,
  task: () => Promise<T>,
): Promise<T> {
  const ensureActive = () => {
    assertActiveGeneration(generation);
    return task();
  };
  const run = generation.writeQueue.then(ensureActive, ensureActive);
  generation.writeQueue = run.catch(() => undefined);
  return run;
}

export async function fetchFinancialData(): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(
    generation,
    () => reconcileGeneration(generation, defaultFinancialData()),
  );
}

export async function saveFinancialData(data: FinancialData): Promise<FinancialData> {
  const generation = activeGeneration;
  const reconciliationEpoch = generation.reconciliationEpoch;
  return enqueueWrite(generation, async () => {
    if (generation.mustReconcile) await reconcileGeneration(generation);
    if (reconciliationEpoch !== generation.reconciliationEpoch) {
      throw new StaleFinancialReplacementError();
    }
    return saveFinancialDataForGeneration(generation, data);
  });
}

export type ReviewedBankImportRow = {
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

export function commitBankStatementImport(rows: ReviewedBankImportRow[], expectedAccountId: string) {
  return request<{ added: unknown[]; duplicateCount: number; data: FinancialData }>(
    "/api/financial-data/bank-statement-import",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedAccountId, rows }) },
  );
}

async function saveFinancialDataForGeneration(
  generation: FinancialDataGeneration,
  data: FinancialData,
): Promise<FinancialData> {
  assertActiveGeneration(generation);
  const { monthlyReports, ...transportDocument } = data;
  void monthlyReports;
  const payload = await request<unknown>("/api/financial-data", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(transportDocument),
  });
  assertActiveGeneration(generation);
  const saved = normalizeFinancialData(payload);
  generation.latestKnownData = saved;
  return saved;
}

export async function updateFinancialData(
  updater: (current: FinancialData) => FinancialData,
): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(generation, async () => {
    const current = await ensureGenerationData(generation);
    return saveFinancialDataForGeneration(generation, updater(current));
  });
}

/**
 * Serializes a server mutation that writes financial state outside the
 * whole-document endpoint with ordinary financial writes. The updater only
 * updates this account generation's authoritative snapshot; it does not issue
 * another PUT.
 */
export async function enqueueExternalFinancialMutation<Result>(
  mutation: () => Promise<Result>,
  updater: (current: FinancialData, result: Result) => FinancialData,
): Promise<{ result: Result; data: FinancialData }> {
  const generation = activeGeneration;
  return enqueueWrite(generation, async () => {
    const current = await ensureGenerationData(generation);
    assertActiveGeneration(generation);
    try {
      const result = await mutation();
      assertActiveGeneration(generation);
      const data = updater(current, result);
      generation.latestKnownData = data;
      return { result, data };
    } catch (error) {
      assertActiveGeneration(generation);
      generation.latestKnownData = null;
      generation.mustReconcile = true;
      generation.reconciliationEpoch += 1;
      let reconciledData: FinancialData | null = null;
      try {
        reconciledData = await reconcileGeneration(generation);
      } catch (reconciliationError) {
        if (isFinancialAccountSwitchError(reconciliationError)) throw reconciliationError;
      }
      throw new UncertainExternalFinancialMutationError(
        error instanceof Error ? error.message : "The server response was lost; financial data was reconciled.",
        reconciledData,
        { cause: error },
      );
    }
  });
}

export async function updateFinancialHealthPlanning(
  update: FinancialHealthPlanningUpdate,
): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(generation, async () => {
    const payload = await request<unknown>("/api/financial-data/health", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update),
    });
    assertActiveGeneration(generation);
    generation.latestKnownData = normalizeFinancialData(payload);
    return generation.latestKnownData;
  });
}

export async function updateRetirementPlanning(
  retirementInputs: RetirementInputs,
): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(generation, async () => {
    const payload = await request<unknown>("/api/financial-data/retirement-plan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(retirementInputs),
    });
    assertActiveGeneration(generation);
    generation.latestKnownData = normalizeFinancialData(payload);
    return generation.latestKnownData;
  });
}

export async function managePlanningCategory(
  category: string,
  action: "archive" | "restore" | "rename",
  nextCategory?: string,
): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(generation, async () => {
    const payload = await request<unknown>(
      `/api/financial-data/planning-categories/${encodeURIComponent(category)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "rename"
            ? { action, nextCategory }
            : { action },
        ),
      },
    );
    assertActiveGeneration(generation);
    generation.latestKnownData = normalizeFinancialData(payload);
    return generation.latestKnownData;
  });
}

export async function savePushSubscription(
  subscription: BrowserPushSubscription,
): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(generation, async () => {
    const payload = await request<unknown>("/api/financial-data/push-subscriptions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription),
    });
    assertActiveGeneration(generation);
    generation.latestKnownData = normalizeFinancialData(payload);
    return generation.latestKnownData;
  });
}

export async function loadWebPushConfiguration(): Promise<WebPushConfiguration> {
  const value = await request<unknown>("/api/financial-data/push-configuration");
  if (
    isRecord(value)
    && value.supported === true
    && typeof value.publicKey === "string"
    && value.publicKey.trim()
  ) {
    return { supported: true, publicKey: value.publicKey };
  }
  return { supported: false };
}

export async function removePushSubscription(endpoint: string): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(generation, async () => {
    const payload = await request<unknown>("/api/financial-data/push-subscriptions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    assertActiveGeneration(generation);
    generation.latestKnownData = normalizeFinancialData(payload);
    return generation.latestKnownData;
  });
}

export async function saveMonthlyReport(
  report: MonthlyReportSnapshot,
): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(generation, async () => {
    const { retirementForecast, ...transportReport } = report;
    void retirementForecast;
    const payload = await request<unknown>("/api/financial-data/monthly-reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(transportReport),
    });
    assertActiveGeneration(generation);
    generation.latestKnownData = normalizeFinancialData(payload);
    return generation.latestKnownData;
  });
}

export async function emailMonthlyReport(reportId: string): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(
    generation,
    () => performCanonicalFinancialMutation(
      generation,
      () => request<unknown>(
        `/api/financial-data/monthly-reports/${encodeURIComponent(reportId)}/email`,
        { method: "POST" },
      ),
      "The report email result was lost; delivery status was refreshed.",
    ),
  );
}

export async function deleteFinancialExpense(id: string): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(generation, async () => {
    await ensureGenerationData(generation);
    return performCanonicalFinancialMutation(
      generation,
      () => request<unknown>(
        `/api/financial-data/expenses/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
      "The delete response was lost; financial data was reconciled.",
    );
  });
}

export async function restoreFinancialData(data: FinancialData): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(generation, async () => {
    const serializedBackup = JSON.stringify(data);
    const size = new TextEncoder().encode(serializedBackup).byteLength;
    const directRestoreLimit = 3.5 * 1024 * 1024;

    if (size <= directRestoreLimit) {
      return performCanonicalFinancialMutation(
        generation,
        () => request<unknown>("/api/financial-data/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: serializedBackup,
        }),
        "The restore response was lost; financial data was reconciled.",
      );
    }

    // Only the final restore request is a canonical mutation. A failed or
    // abandoned staging upload is safe to expire without reconciliation.
    if (generation.mustReconcile) {
      await reconcileGeneration(generation);
      assertActiveGeneration(generation);
    }
    assertActiveGeneration(generation);
    const upload = await request<unknown>("/api/financial-data/restore-uploads/request-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ size, contentType: "application/json" }),
    });
    assertActiveGeneration(generation);
    if (
      !isRecord(upload)
      || typeof upload.uploadURL !== "string"
      || !upload.uploadURL.trim()
      || typeof upload.objectPath !== "string"
      || !upload.objectPath.trim()
    ) {
      throw new Error("The server did not provide a valid restore upload destination.");
    }

    assertActiveGeneration(generation);
    const uploadResponse = await fetch(upload.uploadURL, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: serializedBackup,
      credentials: "omit",
    });
    assertActiveGeneration(generation);
    if (!uploadResponse.ok) {
      throw new Error("The backup upload did not complete. Your financial data was not restored.");
    }

    assertActiveGeneration(generation);
    return performCanonicalFinancialMutation(
      generation,
      () => request<unknown>("/api/financial-data/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          restoreUpload: { objectPath: upload.objectPath, size },
        }),
      }),
      "The restore response was lost; financial data was reconciled.",
    );
  });
}

export async function clearFinancialData(): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(generation, () =>
    performCanonicalFinancialMutation(
      generation,
      () => request<unknown>("/api/financial-data", { method: "DELETE" }),
      "The clear response was lost; financial data was reconciled.",
    ),
  );
}
