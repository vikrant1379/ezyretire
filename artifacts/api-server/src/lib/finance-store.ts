import {
  budgetsTable,
  db,
  expensesTable,
  incomeSourcesTable,
  investmentsTable,
  loansTable,
  retirementPlansTable,
  salaryDetailsTable,
  type StoredBudgetSchedule,
  userProfilesTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

export type FinancialDataResponse = {
  expenses: unknown[];
  budgets: unknown[];
  incomeSources: unknown[];
  investments: unknown[];
  loans: unknown[];
  retirementInputs: {
    dateOfBirth: string;
    targetRetirementAge: number;
    lifeExpectancy: number;
    generalInflation: number;
    salaryGrowth: number;
    monthlyContributionOverride?: number;
    investSurplus: boolean;
  };
  profileInputs: {
    fullName?: string;
    gender?: string;
    email?: string;
    phone?: string;
    onboardingCompleted?: boolean;
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
  };
};

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
    const normalized: StoredBudgetSchedule = {
      id: rowId(schedule.id),
      amount: Math.max(0, asNumber(schedule.amount ?? schedule.monthlyLimit)),
      startMonth,
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
  profile: Pick<typeof userProfilesTable.$inferSelect, "riskPreference" | "uiPreferences"> | undefined;
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
  const { profile, plan, expenses, budgets, incomeSources, investments, loans } = rows;
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
        prepayments: asNumber(row.prepayments),
        notes: row.notes || undefined,
        createdAt: row.createdAt.toISOString(),
      }),
    ),
    retirementInputs: {
      dateOfBirth,
      targetRetirementAge,
      lifeExpectancy,
      generalInflation: asNumber(plan?.generalInflationPct, 6),
      salaryGrowth: asNumber(plan?.salaryGrowthPct, 8),
      monthlyContributionOverride,
      investSurplus: plan?.investSurplus ?? false,
    },
    profileInputs: {
      fullName: user.fullName ?? undefined,
      gender: user.gender ?? undefined,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      onboardingCompleted: user.onboardingCompleted,
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
  const [profile, plan, expenses, budgets, incomeSources, investments, loans] =
    await Promise.all([
      db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, user.id)).limit(1),
      db.select().from(retirementPlansTable).where(eq(retirementPlansTable.userId, user.id)).limit(1),
      db.select().from(expensesTable).where(eq(expensesTable.userId, user.id)),
      db.select().from(budgetsTable).where(eq(budgetsTable.userId, user.id)),
      db.select().from(incomeSourcesTable).where(eq(incomeSourcesTable.userId, user.id)),
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
    salary,
    investments,
    loans,
  });
}

export class PlanningCategoryConflictError extends Error {}

export async function managePlanningCategory(
  user: typeof usersTable.$inferSelect,
  category: string,
  action: "archive" | "rename" | "restore",
  nextCategory?: string,
): Promise<FinancialDataResponse> {
  await db.transaction(async (tx) => {
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
  });

  return loadFinancialData(user);
}

export async function saveFinancialData(
  user: typeof usersTable.$inferSelect,
  payload: Record<string, unknown>,
  legacyBlob?: Record<string, unknown>,
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
  const investments = asArray(payload.investments ?? legacyBlob?.investments);
  const loans = asArray(payload.loans ?? legacyBlob?.loans);

  const targetRetirementAge = Math.round(
    asNumber(profileInputs.targetRetirementAge ?? retirementInputs.targetRetirementAge, 55),
  );
  const lifeExpectancy = Math.round(
    asNumber(profileInputs.lifeExpectancy ?? retirementInputs.lifeExpectancy, 85),
  );
  const riskPreference = asString(profileInputs.riskPreference, "Balanced") || "Balanced";
  const uiPreferences = normalizeUiPreferences(payload.uiPreferences);

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

  const expenseRows = expenses.filter(isRecord).map((expense) => ({
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

  await db.transaction(async (tx) => {
    // Profile and plan upserts travel together as one statement.
    await tx.execute(sql`
      with saved_profile as (
        insert into user_profiles (user_id, risk_preference, ui_preferences, updated_at)
        values (${user.id}, ${riskPreference}, cast(${JSON.stringify(uiPreferences)} as jsonb), ${istNow})
        on conflict (user_id) do update
          set risk_preference = excluded.risk_preference,
              ui_preferences = excluded.ui_preferences,
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
        cleared_expenses as (delete from expenses where user_id = ${user.id}),
        cleared_budgets as (delete from budgets where user_id = ${user.id}),
        cleared_income as (delete from income_sources where user_id = ${user.id}),
        cleared_loans as (delete from loans where user_id = ${user.id})
      select 1
    `);

    // Loans and income go first: expenses and investments reference them.
    if (loanRows.length > 0) await tx.insert(loansTable).values(loanRows);
    if (incomeRows.length > 0) {
      await tx.insert(incomeSourcesTable).values(
        incomeRows.map(({ salaryDetails: _salary, ...row }) => row),
      );
      if (salaryRows.length > 0) await tx.insert(salaryDetailsTable).values(salaryRows);
    }
    if (expenseRows.length > 0) await tx.insert(expensesTable).values(expenseRows);
    if (budgetRows.length > 0) await tx.insert(budgetsTable).values(budgetRows);
    if (investmentRows.length > 0) await tx.insert(investmentsTable).values(investmentRows);
  });

  // The rows above are exactly what the database now holds, so the response is
  // built from them rather than spending another round trip reading them back.
  return buildFinancialData(user, {
    profile: { riskPreference, uiPreferences },
    plan: {
      targetRetirementAge,
      lifeExpectancy,
      generalInflationPct,
      salaryGrowthPct,
      monthlyContributionOverride: contributionOverride,
      investSurplus,
    },
    expenses: expenseRows,
    budgets: budgetRows,
    incomeSources: incomeRows,
    salary: salaryRows,
    investments: investmentRows,
    loans: loanRows,
  });
}

export async function clearFinancialData(userId: string): Promise<void> {
  // A single statement is atomic on its own, so this needs no transaction and
  // costs one round trip instead of nine.
  await db.execute(sql`
    with
      cleared_investments as (delete from investments where user_id = ${userId}),
      cleared_expenses as (delete from expenses where user_id = ${userId}),
      cleared_budgets as (delete from budgets where user_id = ${userId}),
      cleared_income as (delete from income_sources where user_id = ${userId}),
      cleared_loans as (delete from loans where user_id = ${userId}),
      cleared_plan as (delete from retirement_plans where user_id = ${userId}),
      cleared_profile as (delete from user_profiles where user_id = ${userId})
    select 1
  `);
}
