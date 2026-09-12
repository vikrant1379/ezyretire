import type {
  MonthlyReportMetricFormat,
  MonthlyReportSectionId,
  MonthlyReportSnapshot,
} from "./storage.ts";

export type MonthlyReportFacts = {
  month: string;
  actualIncome: number;
  expectedIncome: number;
  actualExpenses: number;
  expenseBudget: number;
  expenseCategoryCount: number;
  topExpenseCategory: string;
  topExpenseCategoryAmount: number;
  savingsAmount: number;
  savingsRatePercent: number;
  portfolioValue: number;
  portfolioReturnChange: number;
  portfolioReturnPercent: number;
  netWorth: number;
  netWorthChange: number;
  retirementDateMovementMonths: number;
  healthScore: number;
  healthScoreChange: number;
  nextMonthActions: string[];
};

type ReportMetrics = Record<string, { value: number; format: MonthlyReportMetricFormat }>;

const definitions: Array<{
  id: MonthlyReportSectionId;
  title: string;
  metrics: (facts: MonthlyReportFacts) => ReportMetrics;
  action: (facts: MonthlyReportFacts) => string[];
}> = [
  { id: "income-vs-expected", title: "Income vs expected", metrics: (f) => ({ actual: { value: f.actualIncome, format: "currency" }, expected: { value: f.expectedIncome, format: "currency" }, variance: { value: f.actualIncome - f.expectedIncome, format: "currency" } }), action: () => [] },
  { id: "expenses-vs-budget-category", title: "Expenses vs budget and category", metrics: (f) => ({ actual: { value: f.actualExpenses, format: "currency" }, budget: { value: f.expenseBudget, format: "currency" }, categoryCount: { value: f.expenseCategoryCount, format: "count" }, topCategorySpend: { value: f.topExpenseCategoryAmount ?? 0, format: "currency" } }), action: (f) => f.expenseCategoryCount ? [`Largest category: ${f.topExpenseCategory || "Uncategorized"} (${(f.topExpenseCategoryAmount ?? 0).toLocaleString("en-IN", { style: "currency", currency: "INR" })}).`] : ["No expenses were recorded for this month."] },
  { id: "savings-amount-rate", title: "Savings amount and rate", metrics: (f) => ({ amount: { value: f.savingsAmount, format: "currency" }, rate: { value: f.savingsRatePercent, format: "percent" } }), action: () => [] },
  { id: "portfolio-value-returns-change", title: "Portfolio value and returns change", metrics: (f) => ({ value: { value: f.portfolioValue, format: "currency" }, returnChange: { value: f.portfolioReturnChange, format: "currency" }, returnPercent: { value: f.portfolioReturnPercent, format: "percent" } }), action: () => [] },
  { id: "net-worth-change", title: "Net-worth change", metrics: (f) => ({ value: { value: f.netWorth, format: "currency" }, change: { value: f.netWorthChange, format: "currency" } }), action: () => [] },
  { id: "retirement-date-movement", title: "Retirement-date movement", metrics: (f) => ({ movementMonths: { value: f.retirementDateMovementMonths, format: "number" } }), action: () => [] },
  { id: "health-score-change", title: "Health-score change", metrics: (f) => ({ score: { value: f.healthScore, format: "number" }, change: { value: f.healthScoreChange, format: "number" } }), action: () => [] },
  { id: "top-next-month-actions", title: "Top 3 next-month actions", metrics: (f) => ({ count: { value: Math.min(3, f.nextMonthActions.length), format: "count" } }), action: (f) => f.nextMonthActions.slice(0, 3) },
];

const finite = (value: number) => Number.isFinite(value) ? value : 0;

/** Calling with identical facts and generatedAt produces byte-for-byte equivalent data. */
export function generateMonthlyReport(
  facts: MonthlyReportFacts,
  generatedAt: string,
): MonthlyReportSnapshot {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(facts.month)) throw new Error("Report month must be YYYY-MM.");
  if (!Number.isFinite(new Date(generatedAt).getTime())) throw new Error("generatedAt must be a valid timestamp.");
  return {
    id: `monthly-report-${facts.month}`,
    month: facts.month,
    generatedAt,
    sections: definitions.map((section) => ({
      id: section.id,
      title: section.title,
      metrics: Object.fromEntries(Object.entries(section.metrics(facts))
        .map(([key, metric]) => [key, finite(metric.value)])),
      metricFormats: Object.fromEntries(Object.entries(section.metrics(facts))
        .map(([key, metric]) => [key, metric.format])),
      actions: section.action(facts),
    })),
  };
}