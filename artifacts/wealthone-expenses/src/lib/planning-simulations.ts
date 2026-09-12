import { formatDateOnly, type PlannedExpense, type RetirementInputs } from "./storage.ts";

export const PLANNING_BENCHMARK_SOURCE =
  "Illustrative 2026 India planning ranges, compiled from public school, healthcare, travel, vehicle and wedding market ranges. Replace them with quotes for your city and family.";

export type PlanningLineItem = {
  id: string;
  name: string;
  category: string;
  amount: number;
  yearsFromNow: number;
  inflationRate: number;
  benchmarkMin: number;
  benchmarkMax: number;
  /** Number of annual costs represented by the entered stage total. */
  durationYears?: number;
};

export const DEPENDENT_STAGES: PlanningLineItem[] = [
  { id: "maternity", name: "Delivery and maternity", category: "Healthcare", amount: 300000, yearsFromNow: 0, inflationRate: 10, benchmarkMin: 100000, benchmarkMax: 1000000 },
  { id: "childcare", name: "Childcare (0–3)", category: "Other", amount: 450000, yearsFromNow: 1, inflationRate: 6, benchmarkMin: 180000, benchmarkMax: 720000, durationYears: 3 },
  { id: "preschool", name: "Pre-school (3–5)", category: "Education", amount: 480000, yearsFromNow: 3, inflationRate: 10, benchmarkMin: 240000, benchmarkMax: 720000, durationYears: 3 },
  { id: "school", name: "School (6–17)", category: "Education", amount: 4560000, yearsFromNow: 6, inflationRate: 10, benchmarkMin: 2160000, benchmarkMax: 11520000, durationYears: 12 },
  { id: "college", name: "Higher education (18–22)", category: "Education", amount: 2500000, yearsFromNow: 18, inflationRate: 10, benchmarkMin: 500000, benchmarkMax: 8000000, durationYears: 5 },
  { id: "activities", name: "Extracurriculars", category: "Education", amount: 1080000, yearsFromNow: 6, inflationRate: 10, benchmarkMin: 432000, benchmarkMax: 2160000, durationYears: 12 },
  { id: "healthcare", name: "Child healthcare", category: "Healthcare", amount: 720000, yearsFromNow: 1, inflationRate: 10, benchmarkMin: 480000, benchmarkMax: 1200000, durationYears: 23 },
  { id: "wedding", name: "Wedding support", category: "Wedding", amount: 2000000, yearsFromNow: 28, inflationRate: 6, benchmarkMin: 1000000, benchmarkMax: 5000000 },
];

export const LIFE_EVENT_TEMPLATES: Record<string, PlanningLineItem[]> = {
  Maternity: [
    { id: "pregnancy", name: "Pregnancy care", category: "Healthcare", amount: 100000, yearsFromNow: 1, inflationRate: 10, benchmarkMin: 50000, benchmarkMax: 250000 },
    { id: "delivery", name: "Delivery", category: "Healthcare", amount: 250000, yearsFromNow: 1, inflationRate: 10, benchmarkMin: 100000, benchmarkMax: 1000000 },
    { id: "postnatal", name: "Post-natal care", category: "Healthcare", amount: 100000, yearsFromNow: 1, inflationRate: 10, benchmarkMin: 50000, benchmarkMax: 300000 },
  ],
  "House purchase": [
    { id: "deposit", name: "Down payment", category: "Home", amount: 2000000, yearsFromNow: 3, inflationRate: 6, benchmarkMin: 1000000, benchmarkMax: 5000000 },
    { id: "registration", name: "Registration and stamp duty", category: "Home", amount: 600000, yearsFromNow: 3, inflationRate: 6, benchmarkMin: 250000, benchmarkMax: 1500000 },
    { id: "interiors", name: "Interiors", category: "Home", amount: 800000, yearsFromNow: 3, inflationRate: 6, benchmarkMin: 300000, benchmarkMax: 2500000 },
    { id: "society", name: "Society charges", category: "Home", amount: 100000, yearsFromNow: 3, inflationRate: 6, benchmarkMin: 50000, benchmarkMax: 300000 },
  ],
  "Wedding (self)": [
    { id: "venue", name: "Venue and hospitality", category: "Wedding", amount: 1000000, yearsFromNow: 5, inflationRate: 6, benchmarkMin: 500000, benchmarkMax: 3000000 },
    { id: "jewellery", name: "Jewellery and clothing", category: "Wedding", amount: 600000, yearsFromNow: 5, inflationRate: 6, benchmarkMin: 250000, benchmarkMax: 2000000 },
  ],
  "Car purchase": [
    { id: "deposit", name: "Down payment", category: "Vehicle", amount: 300000, yearsFromNow: 4, inflationRate: 5, benchmarkMin: 150000, benchmarkMax: 750000 },
    { id: "insurance", name: "Insurance", category: "Vehicle", amount: 60000, yearsFromNow: 4, inflationRate: 5, benchmarkMin: 30000, benchmarkMax: 150000 },
    { id: "running", name: "First-year maintenance and fuel", category: "Vehicle", amount: 120000, yearsFromNow: 4, inflationRate: 6, benchmarkMin: 60000, benchmarkMax: 240000 },
  ],
  "Relocation / job change": [
    { id: "deposit", name: "Rental deposit", category: "Home", amount: 200000, yearsFromNow: 1, inflationRate: 6, benchmarkMin: 50000, benchmarkMax: 600000 },
    { id: "moving", name: "Moving costs", category: "Other", amount: 75000, yearsFromNow: 1, inflationRate: 6, benchmarkMin: 25000, benchmarkMax: 200000 },
    { id: "furnishing", name: "Furnishing", category: "Home", amount: 200000, yearsFromNow: 1, inflationRate: 6, benchmarkMin: 75000, benchmarkMax: 600000 },
  ],
  "Medical emergency fund": [
    { id: "medical", name: "Medical reserve", category: "Healthcare", amount: 750000, yearsFromNow: 2, inflationRate: 10, benchmarkMin: 300000, benchmarkMax: 2000000 },
  ],
  "Sabbatical / career break": [
    { id: "runway", name: "Living-cost runway", category: "Other", amount: 600000, yearsFromNow: 3, inflationRate: 6, benchmarkMin: 300000, benchmarkMax: 1800000 },
  ],
  "Starting a business": [
    { id: "investment", name: "Initial investment", category: "Other", amount: 1000000, yearsFromNow: 4, inflationRate: 6, benchmarkMin: 300000, benchmarkMax: 5000000 },
    { id: "runway", name: "Personal runway", category: "Other", amount: 600000, yearsFromNow: 4, inflationRate: 6, benchmarkMin: 300000, benchmarkMax: 1800000 },
  ],
  "Parents' medical emergency": [
    { id: "parents-medical", name: "Parents' medical reserve", category: "Healthcare", amount: 1000000, yearsFromNow: 2, inflationRate: 10, benchmarkMin: 400000, benchmarkMax: 3000000 },
  ],
  "Divorce / separation": [
    { id: "legal", name: "Legal costs", category: "Other", amount: 300000, yearsFromNow: 2, inflationRate: 6, benchmarkMin: 100000, benchmarkMax: 1000000 },
    { id: "settlement", name: "Settlement reserve", category: "Other", amount: 1000000, yearsFromNow: 2, inflationRate: 6, benchmarkMin: 300000, benchmarkMax: 5000000 },
    { id: "transition", name: "Lifestyle transition", category: "Home", amount: 400000, yearsFromNow: 2, inflationRate: 6, benchmarkMin: 150000, benchmarkMax: 1200000 },
  ],
};

const DEPENDENT_STAGE_PERIODS: Record<string, { start: number; end?: number; oneTime?: boolean }> = {
  maternity: { start: 0, oneTime: true },
  childcare: { start: 0, end: 3 },
  preschool: { start: 3, end: 6 },
  school: { start: 6, end: 18 },
  college: { start: 18, end: 23 },
  activities: { start: 6, end: 18 },
  healthcare: { start: 0, end: 23 },
  wedding: { start: 28, oneTime: true },
};

/** A planned child is represented by age -1, meaning an expected birth in one year. */
export function dependentStagesForAge(age: number) {
  const normalizedAge = Number.isFinite(age) ? Math.max(-1, Math.min(30, age)) : -1;
  return DEPENDENT_STAGES.flatMap((item) => {
    const period = DEPENDENT_STAGE_PERIODS[item.id];
    if (!period) return [{ ...item }];
    const yearsUntilStart = normalizedAge < 0
      ? period.start + 1
      : Math.max(0, period.start - normalizedAge);
    if (period.oneTime) {
      if (normalizedAge > period.start) return [];
      return [{ ...item, yearsFromNow: yearsUntilStart }];
    }
    if (period.end !== undefined && normalizedAge >= period.end) return [];
    const fullDuration = Math.max(1, (period.end ?? period.start + 1) - period.start);
    const remainingDuration = normalizedAge < 0
      ? fullDuration
      : Math.max(0, (period.end ?? period.start + 1) - Math.max(normalizedAge, period.start));
    return [{
      ...item,
      yearsFromNow: yearsUntilStart,
      amount: item.amount * remainingDuration / fullDuration,
      durationYears: Math.max(1, Math.ceil(remainingDuration)),
    }];
  });
}

function safe(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function futureValue(amount: number, inflationPercent: number, years: number) {
  return safe(amount) * Math.pow(1 + Math.min(25, safe(inflationPercent)) / 100, safe(years));
}

export function purchasingPower(amount: number, inflationPercent: number, years: number) {
  return safe(amount) / Math.pow(1 + Math.min(25, safe(inflationPercent)) / 100, safe(years));
}

export function planningItemYearlyBreakdown(items: PlanningLineItem[]) {
  return items.flatMap((item) => {
    const durationYears = Math.max(1, Math.floor(safe(item.durationYears ?? 1, 1)));
    const annualAmount = safe(item.amount) / durationYears;
    return Array.from({ length: durationYears }, (_, yearIndex) => {
      const yearsFromNow = safe(item.yearsFromNow) + yearIndex;
      return {
        item,
        yearIndex,
        yearsFromNow,
        amount: annualAmount,
        futureCost: futureValue(annualAmount, item.inflationRate, yearsFromNow),
      };
    });
  });
}

export function planningItemFutureCost(item: PlanningLineItem) {
  return planningItemYearlyBreakdown([item]).reduce((sum, row) => sum + row.futureCost, 0);
}

export function lineItemsToPlannedExpenses(
  prefix: string,
  items: PlanningLineItem[],
  asOf = new Date(),
): PlannedExpense[] {
  return planningItemYearlyBreakdown(items)
    .filter((row) => row.amount > 0)
    .map((row) => {
    const date = new Date(asOf.getFullYear() + Math.round(row.yearsFromNow), asOf.getMonth(), 1);
    const durationYears = Math.max(1, Math.floor(safe(row.item.durationYears ?? 1, 1)));
    return {
      id: crypto.randomUUID(),
      name: `${prefix}: ${row.item.name}${durationYears > 1 ? ` (year ${row.yearIndex + 1} of ${durationYears})` : ""}`,
      category: row.item.category,
      amount: row.amount,
      expectedDate: formatDateOnly(date),
      customInflationRate: Math.min(25, safe(row.item.inflationRate)),
      createdAt: new Date().toISOString(),
    };
  });
}

export type RetirementScenario = {
  retirementAge: number;
  contribution: number;
  inflation: number;
  spendingChange: number;
};

export function buildScenarioRetirementInputs(
  baseline: RetirementInputs,
  scenario: RetirementScenario,
): RetirementInputs {
  const savedAdjustment = Math.max(
    -90,
    Math.min(300, Number(baseline.retirementSpendingAdjustmentPercent) || 0),
  );
  const requestedAdjustment = Number(scenario.spendingChange);
  const relativeAdjustment = Math.max(
    -90,
    Math.min(300, Number.isFinite(requestedAdjustment) ? requestedAdjustment : 0),
  );
  return {
    ...baseline,
    targetRetirementAge: scenario.retirementAge,
    monthlyContributionOverride: scenario.contribution,
    generalInflation: scenario.inflation,
    retirementSpendingAdjustmentPercent: Math.max(
      -90,
      Math.min(
        300,
        ((1 + savedAdjustment / 100) * (1 + relativeAdjustment / 100) - 1) * 100,
      ),
    ),
  };
}

export function mergeRetirementScenarioInputs(
  current: RetirementInputs,
  scenario: RetirementInputs,
): RetirementInputs {
  return {
    ...current,
    targetRetirementAge: scenario.targetRetirementAge,
    monthlyContributionOverride: scenario.monthlyContributionOverride,
    generalInflation: scenario.generalInflation,
    retirementSpendingAdjustmentPercent: scenario.retirementSpendingAdjustmentPercent,
  };
}

export type PlannedExpenseOperation =
  | { type: "append"; expenses: PlannedExpense[] }
  | { type: "remove"; id: string };

export function applyPlannedExpenseOperation(
  current: PlannedExpense[],
  operation: PlannedExpenseOperation,
) {
  if (operation.type === "remove") {
    return current.filter((expense) => expense.id !== operation.id);
  }
  const incomingIds = new Set(operation.expenses.map((expense) => expense.id));
  return [...current.filter((expense) => !incomingIds.has(expense.id)), ...operation.expenses];
}

export type SipYear = {
  year: number;
  monthlyContribution: number;
  annualContribution: number;
  closingCorpus: number;
};

export function calculateStepUpSip(input: {
  monthlyContribution: number;
  annualStepUpPercent: number;
  annualReturnPercent: number;
  years: number;
  startingCorpus?: number;
}) {
  const years = Math.min(60, Math.floor(safe(input.years)));
  const annualRate = Math.min(50, safe(input.annualReturnPercent)) / 100;
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  const stepRate = Math.min(100, safe(input.annualStepUpPercent)) / 100;
  let corpus = safe(input.startingCorpus ?? 0);
  let flatCorpus = corpus;
  const rows: SipYear[] = [];
  for (let year = 1; year <= years; year += 1) {
    const monthlyContribution = safe(input.monthlyContribution) * Math.pow(1 + stepRate, year - 1);
    for (let month = 0; month < 12; month += 1) {
      corpus = corpus * (1 + monthlyRate) + monthlyContribution;
      flatCorpus = flatCorpus * (1 + monthlyRate) + safe(input.monthlyContribution);
    }
    rows.push({ year, monthlyContribution, annualContribution: monthlyContribution * 12, closingCorpus: corpus });
  }
  const target = corpus;
  let flatMonths = 0;
  let comparisonCorpus = safe(input.startingCorpus ?? 0);
  while (comparisonCorpus < target && flatMonths < 1200) {
    comparisonCorpus = comparisonCorpus * (1 + monthlyRate) + safe(input.monthlyContribution);
    flatMonths += 1;
  }
  const flatTargetReached = comparisonCorpus >= target;
  return {
    rows,
    corpus,
    flatCorpus,
    flatTargetReached,
    monthsGained: flatTargetReached ? Math.max(0, flatMonths - years * 12) : null,
  };
}