import { loanPayoffDetails, investmentProjectedValue } from "./retirement-projection.ts";
import { calculateIncomeMetrics } from "./financial-metrics.ts";
import type { IncomeSource, Investment, Loan } from "./storage.ts";

export type SortDirection = "asc" | "desc";

export type InvestmentSortBy = "manual" | "invested" | "current" | "gain" | "projected";
export type LoanSortBy = "manual" | "outstanding" | "emi" | "remaining" | "interest";
export type IncomeSortBy = "manual" | "monthly" | "annual" | "growth";

export type ListSort<By extends string> = {
  by: By;
  direction: SortDirection;
};

export type InvestmentSchedulingContext = {
  asOf?: Date;
  monthsToRetirement?: number;
  incomes?: IncomeSource[];
};

export type UiPreferences = {
  investmentOrder: string[];
  loanOrder: string[];
  incomeOrder: string[];
  archivedPlanningCategories: string[];
  investmentSort: ListSort<InvestmentSortBy>;
  loanSort: ListSort<LoanSortBy>;
  incomeSort: ListSort<IncomeSortBy>;
};

export function pendingSortAfterConfirmation<By extends string>(
  pending: ListSort<By> | null,
  confirmed: ListSort<By>,
): ListSort<By> | null {
  if (!pending) return null;
  return confirmed.by === pending.by && confirmed.direction === pending.direction
    ? null
    : pending;
}

const investmentSortKeys = new Set<InvestmentSortBy>([
  "manual",
  "invested",
  "current",
  "gain",
  "projected",
]);
const loanSortKeys = new Set<LoanSortBy>(["manual", "outstanding", "emi", "remaining", "interest"]);
const incomeSortKeys = new Set<IncomeSortBy>(["manual", "monthly", "annual", "growth"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function asSortChoice<By extends string>(
  value: unknown,
  allowed: Set<By>,
  fallback: By,
): ListSort<By> {
  const record = isRecord(value) ? value : {};
  const by = typeof record.by === "string" && allowed.has(record.by as By) ? (record.by as By) : fallback;
  const direction: SortDirection = record.direction === "asc" ? "asc" : "desc";
  return { by, direction };
}

export function defaultUiPreferences(): UiPreferences {
  return {
    investmentOrder: [],
    loanOrder: [],
    incomeOrder: [],
    archivedPlanningCategories: [],
    investmentSort: { by: "manual", direction: "desc" },
    loanSort: { by: "manual", direction: "desc" },
    incomeSort: { by: "manual", direction: "desc" },
  };
}

export function normalizeUiPreferences(value: unknown): UiPreferences {
  const record = isRecord(value) ? value : {};
  return {
    investmentOrder: asIdList(record.investmentOrder),
    loanOrder: asIdList(record.loanOrder),
    incomeOrder: asIdList(record.incomeOrder),
    archivedPlanningCategories: asIdList(record.archivedPlanningCategories),
    investmentSort: asSortChoice(record.investmentSort, investmentSortKeys, "manual"),
    loanSort: asSortChoice(record.loanSort, loanSortKeys, "manual"),
    incomeSort: asSortChoice(record.incomeSort, incomeSortKeys, "manual"),
  };
}

type OrderedItem = { id: string; createdAt: string };

/**
 * Known IDs keep the saved order. IDs that are gone are dropped. Items that
 * were added after the last reorder sit at the front, newest first.
 */
export function applyCustomOrder<T extends OrderedItem>(items: T[], order: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const placed = new Set<string>();
  const ordered: T[] = [];

  for (const id of order) {
    const item = byId.get(id);
    if (!item || placed.has(id)) continue;
    ordered.push(item);
    placed.add(id);
  }

  const newcomers = items
    .filter((item) => !placed.has(item.id))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return [...newcomers, ...ordered];
}

function compareNumbers(left: number, right: number, direction: SortDirection) {
  const delta = left - right;
  if (delta === 0) return 0;
  return direction === "asc" ? delta : -delta;
}

export function sortInvestments(
  items: Investment[],
  preferences: UiPreferences,
  yearsToRetirement: number,
  schedulingContext?: InvestmentSchedulingContext,
): Investment[] {
  const ordered = applyCustomOrder(items, preferences.investmentOrder);
  const { by, direction } = preferences.investmentSort;
  if (by === "manual") return ordered;

  const rank = new Map(ordered.map((item, index) => [item.id, index]));
  return [...ordered].sort((left, right) => {
    const values = {
      invested: [left.investedAmount, right.investedAmount],
      current: [left.currentValue, right.currentValue],
      gain: [left.currentValue - left.investedAmount, right.currentValue - right.investedAmount],
      projected: [
          investmentProjectedValue(left, yearsToRetirement, schedulingContext),
          investmentProjectedValue(right, yearsToRetirement, schedulingContext),
      ],
    } as const;
    const [leftValue, rightValue] = values[by];
    const numeric = compareNumbers(leftValue, rightValue, direction);
    if (numeric !== 0) return numeric;
    return (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0);
  });
}

export function sortLoans(items: Loan[], preferences: UiPreferences, asOf = new Date()): Loan[] {
  const ordered = applyCustomOrder(items, preferences.loanOrder);
  const { by, direction } = preferences.loanSort;
  if (by === "manual") return ordered;

  const rank = new Map(ordered.map((item, index) => [item.id, index]));
  return [...ordered].sort((left, right) => {
    const leftPayoff = loanPayoffDetails(left, asOf);
    const rightPayoff = loanPayoffDetails(right, asOf);
    const values = {
      outstanding: [left.outstandingPrincipal, right.outstandingPrincipal],
      emi: [left.emi, right.emi],
      remaining: [leftPayoff.remainingMonths, rightPayoff.remainingMonths],
      interest: [leftPayoff.totalInterestLeft, rightPayoff.totalInterestLeft],
    } as const;
    const [leftValue, rightValue] = values[by];
    const numeric = compareNumbers(leftValue, rightValue, direction);
    if (numeric !== 0) return numeric;
    return (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0);
  });
}

export function sortIncomeSources(items: IncomeSource[], preferences: UiPreferences): IncomeSource[] {
  const ordered = applyCustomOrder(items, preferences.incomeOrder);
  const { by, direction } = preferences.incomeSort;
  if (by === "manual") return ordered;

  const rank = new Map(ordered.map((item, index) => [item.id, index]));
  return [...ordered].sort((left, right) => {
    const leftMetrics = calculateIncomeMetrics(left);
    const rightMetrics = calculateIncomeMetrics(right);
    const values = {
      monthly: [leftMetrics.monthlyNet, rightMetrics.monthlyNet],
      annual: [leftMetrics.annualGross, rightMetrics.annualGross],
      growth: [left.annualGrowthRate ?? 0, right.annualGrowthRate ?? 0],
    } as const;
    const [leftValue, rightValue] = values[by];
    const numeric = compareNumbers(leftValue, rightValue, direction);
    if (numeric !== 0) return numeric;
    return (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0);
  });
}

export function moveItem(ids: string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

export function prependId(order: string[], id: string): string[] {
  return [id, ...order.filter((existing) => existing !== id)];
}

export function dropId(order: string[], id: string): string[] {
  return order.filter((existing) => existing !== id);
}
