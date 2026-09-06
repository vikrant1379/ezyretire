import { formatDateOnly, normalizeBudgets, normalizeIncomeSchedule, normalizeInvestmentContributionSchedule, type Budget, type Expense, type IncomeSource, type Investment, type Loan, type ProfileInputs, type RetirementInputs } from "./storage.ts";
import {
  defaultUiPreferences,
  normalizeUiPreferences,
  type UiPreferences,
} from "./card-order.ts";

export type FinancialData = {
  expenses: Expense[];
  budgets: Budget[];
  incomeSources: IncomeSource[];
  investments: Investment[];
  loans: Loan[];
  retirementInputs: RetirementInputs;
  profileInputs: ProfileInputs;
  uiPreferences: UiPreferences;
};

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
    investments: [],
    loans: [],
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
  const dateOfBirth = asString(
    rawProfile.dateOfBirth ?? rawRetirement.dateOfBirth,
    defaults.profileInputs.dateOfBirth,
  );

  return {
    expenses: asArray<Expense>(value.expenses),
    budgets: normalizeBudgets(value.budgets),
    incomeSources: asArray<IncomeSource>(value.incomeSources).map(normalizeIncomeSchedule),
    investments: asArray<Investment>(value.investments).map((investment) =>
      normalizeInvestmentContributionSchedule(investment),
    ),
    loans: asArray<Loan>(value.loans),
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
};

function newFinancialDataGeneration(): FinancialDataGeneration {
  return {
    latestKnownData: null,
    writeQueue: Promise.resolve(),
  };
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
  const payload = await request<unknown>("/api/financial-data", undefined, defaultFinancialData());
  const data = normalizeFinancialData(payload);
  if (generation === activeGeneration) {
    generation.latestKnownData = data;
  }
  return data;
}

export async function saveFinancialData(data: FinancialData): Promise<FinancialData> {
  const generation = activeGeneration;
  return saveFinancialDataForGeneration(generation, data);
}

async function saveFinancialDataForGeneration(
  generation: FinancialDataGeneration,
  data: FinancialData,
): Promise<FinancialData> {
  assertActiveGeneration(generation);
  const payload = await request<unknown>("/api/financial-data", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
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
    if (!generation.latestKnownData) {
      const payload = await request<unknown>("/api/financial-data", undefined, defaultFinancialData());
      assertActiveGeneration(generation);
      generation.latestKnownData = normalizeFinancialData(payload);
    }
    const current = generation.latestKnownData;
    return saveFinancialDataForGeneration(generation, updater(current));
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

export async function clearFinancialData(): Promise<FinancialData> {
  const generation = activeGeneration;
  return enqueueWrite(generation, async () => {
    const payload = await request<unknown>("/api/financial-data", {
      method: "DELETE",
    });
    assertActiveGeneration(generation);
    generation.latestKnownData = normalizeFinancialData(payload);
    return generation.latestKnownData;
  });
}
