import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateActualMonthlyAverage,
  calculateRetirementProjection,
  calculateRetirementReadiness,
  investmentProjectedValue,
  loanPayoffDetails,
  portfolioAllocationPercent,
  remainingLoanMonths,
  type RetirementProjectionArgs,
} from "./retirement-projection.ts";
import { calculateIncomeMetrics } from "./financial-metrics.ts";
import type { Expense, IncomeSource, Loan } from "./storage.ts";

const AS_OF = new Date("2026-09-02T12:00:00.000Z");

const baseArgs = (): RetirementProjectionArgs => ({
  asOf: AS_OF,
  expenses: [],
  budgets: [{ category: "Living", monthlyLimit: 50_000 }],
  incomes: [{
    id: "salary",
    name: "Salary",
    type: "Other",
    frequency: "Monthly",
    amount: 100_000,
    date: "2020-01-01",
    recurring: true,
    createdAt: "2020-01-01",
  }],
  investments: [{
    id: "fund",
    name: "Index fund",
    assetClass: "Mutual Funds",
    investedAmount: 500_000,
    currentValue: 500_000,
    monthlyContribution: 10_000,
    expectedReturn: 10,
    createdAt: "2020-01-01",
  }],
  loans: [],
  assumptions: {
    dateOfBirth: "1990-09-02",
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    generalInflation: 6,
    salaryGrowth: 5,
    investSurplus: true,
  },
});

const income = (overrides: Partial<IncomeSource>): IncomeSource => ({
  id: "income",
  name: "Income",
  type: "Other",
  frequency: "Monthly",
  amount: 10_000,
  date: "2026-10-01",
  recurring: true,
  createdAt: "2026-01-01",
  ...overrides,
});

test("portfolio allocation is zero when the total current value is zero", () => {
  assert.equal(portfolioAllocationPercent(0, 0), 0);
  assert.equal(portfolioAllocationPercent(25, 100), 25);
});

test("a what-if return override changes contribution growth even without investments", () => {
  const args = baseArgs();
  args.investments = [];
  args.assumptions = { ...args.assumptions, monthlyContributionOverride: 10_000 };
  const withoutReturn = calculateRetirementProjection({ ...args, portfolioReturnOverride: 0 });
  const withReturn = calculateRetirementProjection({ ...args, portfolioReturnOverride: 12 });
  assert.equal(withoutReturn.averageExpectedReturn, 0);
  assert.equal(withReturn.averageExpectedReturn, 0.12);
  assert.ok(withReturn.projectedCorpus > withoutReturn.projectedCorpus);
});

test("a positive SIP with zero override still exposes the additional retirement contribution gap", () => {
  const args = baseArgs();
  args.investments = [{
    ...args.investments[0],
    monthlyContribution: 1_000,
  }];
  args.assumptions = { ...args.assumptions, monthlyContributionOverride: 0 };
  const projection = calculateRetirementProjection(args);
  assert.equal(projection.modeledMonthlyContribution, 1_000);
  assert.ok(projection.extraSipRequired > 0);
  assert.ok(
    projection.modeledMonthlyContribution + projection.extraSipRequired
      > projection.modeledMonthlyContribution,
  );
});

const loan = (overrides: Partial<Loan> = {}): Loan => ({
  id: "loan",
  type: "Home",
  name: "Loan",
  sanctionedPrincipal: 120_000,
  outstandingPrincipal: 120_000,
  annualInterestRate: 0,
  interestType: "Fixed",
  totalTenureMonths: 12,
  startDate: "2026-09-01",
  emi: 10_000,
  prepayments: 0,
  createdAt: "2026-09-01",
  ...overrides,
});

const expense = (date: string, amount: number): Expense => ({
  id: `${date}-${amount}`,
  date,
  amount,
  category: "Living",
  merchant: "Merchant",
  paymentMethod: "Card",
  reimbursable: false,
  recurring: false,
  createdAt: date,
});

test("changing a budget changes the required retirement corpus", () => {
  const lower = calculateRetirementProjection(baseArgs());
  const higher = calculateRetirementProjection({
    ...baseArgs(),
    budgets: [{ category: "Living", monthlyLimit: 75_000 }],
  });

  assert.ok(higher.requiredCorpus > lower.requiredCorpus);
  assert.equal(lower.livingCostBaseline, 50_000);
  assert.equal(higher.livingCostBaseline, 75_000);
});

test("retirement lifestyle changes drawdown costs without changing pre-retirement cash flow", () => {
  const projectionFor = (
    lifestyleChoice: "Basic" | "Comfortable" | "Premium" | "Custom",
    customLifestyleExpense?: number,
  ) => calculateRetirementProjection({
    ...baseArgs(),
    assumptions: {
      ...baseArgs().assumptions,
      generalInflation: 0,
      lifestyleChoice,
      customLifestyleExpense,
    },
  });
  const basic = projectionFor("Basic");
  const comfortable = projectionFor("Comfortable");
  const premium = projectionFor("Premium");
  const custom = projectionFor("Custom", 62_500);

  assert.equal(basic.cashFlowCostBaseline, 50_000);
  assert.equal(premium.cashFlowCostBaseline, 50_000);
  assert.equal(custom.cashFlowCostBaseline, 50_000);
  assert.equal(basic.expenseAtRetirement, 37_500);
  assert.equal(comfortable.expenseAtRetirement, 50_000);
  assert.equal(premium.expenseAtRetirement, 75_000);
  assert.equal(custom.expenseAtRetirement, 62_500);
  assert.ok(Math.abs(basic.requiredCorpus / comfortable.requiredCorpus - 0.75) < 1e-10);
  assert.ok(Math.abs(premium.requiredCorpus / comfortable.requiredCorpus - 1.5) < 1e-10);
  assert.ok(Math.abs(custom.requiredCorpus / comfortable.requiredCorpus - 1.25) < 1e-10);
});

test("retirement spending adjustments preserve and scale scheduled future budgets", () => {
  const args = baseArgs();
  const retirementDate = new Date(
    AS_OF.getFullYear() + args.assumptions.targetRetirementAge - 36,
    AS_OF.getMonth(),
    1,
  );
  const futureBudget = {
    category: "Living",
    monthlyLimit: 50_000,
    windows: [{
      id: "retirement-spending",
      monthlyLimit: 100_000,
      startDate: `${retirementDate.getFullYear()}-${String(retirementDate.getMonth() + 1).padStart(2, "0")}-01`,
      endMode: "lifelong" as const,
    }],
  };
  const saved = calculateRetirementProjection({
    ...args,
    budgets: [futureBudget],
    assumptions: { ...args.assumptions, generalInflation: 0 },
  });
  const increased = calculateRetirementProjection({
    ...args,
    budgets: [futureBudget],
    assumptions: {
      ...args.assumptions,
      generalInflation: 0,
      retirementSpendingAdjustmentPercent: 10,
    },
  });
  const savedRetirementExpense = saved.chartData.find((point) => point.phase === "drawdown")?.["Monthly Lifestyle Expense"];
  const increasedRetirementExpense = increased.chartData.find((point) => point.phase === "drawdown")?.["Monthly Lifestyle Expense"];
  assert.equal(savedRetirementExpense, 100_000);
  assert.ok(Math.abs((increasedRetirementExpense ?? 0) - 110_000) < 0.001);
});

test("pensions start at the configured age, escalate annually, and only offset outflow", () => {
  const assumptions = {
    ...baseArgs().assumptions,
    targetRetirementAge: 36,
    lifeExpectancy: 39,
    generalInflation: 0,
    lifestyleChoice: "Comfortable" as const,
  };
  const withoutPension = calculateRetirementProjection({
    ...baseArgs(),
    assumptions,
  });
  const withPension = calculateRetirementProjection({
    ...baseArgs(),
    assumptions: {
      ...assumptions,
      pensionSources: [{
        id: "pension",
        name: "Employer pension",
        monthlyAmount: 10_000,
        startAge: 37,
        annualEscalationRate: 10,
      }],
    },
  });

  const drawdown = withPension.chartData.filter((point) => point.phase === "drawdown");
  assert.deepEqual(
    drawdown.slice(0, 3).map((point) => Number(point["Monthly Pension Income"])),
    [0, 10_000, 11_000],
  );
  assert.deepEqual(
    drawdown.slice(0, 3).map((point) => Number(point["Net Retirement Outflow"])),
    [50_000, 40_000, 39_000],
  );
  assert.ok(withPension.requiredCorpus < withoutPension.requiredCorpus);
  assert.equal(withPension.projectedCorpus, withoutPension.projectedCorpus);
  assert.equal(withPension.currentCorpus, withoutPension.currentCorpus);
});

test("pensions entered in today's rupees are inflated through their start date", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    assumptions: {
      ...baseArgs().assumptions,
      targetRetirementAge: 36,
      lifeExpectancy: 38,
      generalInflation: 6,
      pensionSources: [{
        id: "future-pension",
        name: "Future pension",
        monthlyAmount: 10_000,
        startAge: 37,
        annualEscalationRate: 0,
      }],
    },
  });

  const drawdown = projection.chartData.filter((point) => point.phase === "drawdown");
  assert.deepEqual(
    drawdown.slice(0, 2).map((point) => Math.round(Number(point["Monthly Pension Income"]))),
    [0, 10_600],
  );
});

test("pension escalation earned before retirement is retained", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    assumptions: {
      ...baseArgs().assumptions,
      targetRetirementAge: 60,
      lifeExpectancy: 61,
      generalInflation: 0,
      pensionSources: [{
        id: "early-pension",
        name: "Early pension",
        monthlyAmount: 10_000,
        startAge: 55,
        annualEscalationRate: 10,
      }],
    },
  });

  const retirementStart = projection.chartData.find((point) => point.phase === "drawdown");
  assert.ok(retirementStart);
  assert.ok(Math.abs(Number(retirementStart["Monthly Pension Income"]) - 16_105.1) < 0.01);
});

test("pension offsets never create negative drawdown or inflate the corpus", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    assumptions: {
      ...baseArgs().assumptions,
      targetRetirementAge: 36,
      lifeExpectancy: 37,
      generalInflation: 0,
      pensionSources: [{
        id: "large-pension",
        name: "Large pension",
        monthlyAmount: 100_000,
        annualEscalationRate: 0,
      }],
    },
  });

  assert.equal(projection.requiredCorpus, 0);
  assert.equal(projection.chartData[0]["Net Retirement Outflow"], 0);
  assert.equal(projection.projectedCorpus, projection.currentCorpus);
});

test("a separate emergency reserve never becomes retirement corpus", () => {
  const withoutReserve = calculateRetirementProjection(baseArgs());
  const withReserve = calculateRetirementProjection({
    ...baseArgs(),
    emergencyFund: {
      reserveBalance: 1_000_000,
      targetMonths: 6,
      monthlyContribution: 10_000,
    },
  });

  assert.equal(withReserve.currentCorpus, withoutReserve.currentCorpus);
  assert.equal(withReserve.projectedCorpus, withoutReserve.projectedCorpus);
  assert.equal(withReserve.currentEmergencyFundContribution, 0);
});

test("active emergency contributions reduce available cash flow but not retirement corpus", () => {
  const withoutFund = calculateRetirementProjection(baseArgs());
  const withFund = calculateRetirementProjection({
    ...baseArgs(),
    emergencyFund: {
      reserveBalance: 0,
      targetMonths: 6,
      monthlyContribution: 5_000,
    },
  });

  assert.equal(withFund.currentEmergencyFundContribution, 5_000);
  assert.equal(withFund.availableSurplus, withoutFund.availableSurplus - 5_000);
  assert.equal(withFund.monthlyCashFlowTimeline[0].emergencyFundContribution, 5_000);
  assert.equal(withFund.monthlyCashFlowTimeline[0].surplus, withoutFund.monthlyCashFlowTimeline[0].surplus - 5_000);
  assert.equal(withFund.projectedCorpus, withoutFund.projectedCorpus);
});

test("emergency contribution is capped and stops after the target is reached", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    emergencyFund: {
      reserveBalance: 110_000,
      targetMonths: 3,
      monthlyContribution: 30_000,
    },
  });

  assert.deepEqual(
    projection.emergencyFundContributionTimeline.slice(0, 4).map((entry) => [
      entry.contribution,
      entry.reserveBalance,
      entry.targetAmount,
    ]),
    [
      [30_000, 140_000, 150_000],
      [10_000, 150_000, 150_000],
      [0, 150_000, 150_000],
      [0, 150_000, 150_000],
    ],
  );
});

test("completed expense history changes retirement costs when no budget is set", () => {
  const lower = calculateRetirementProjection({
    ...baseArgs(),
    budgets: [],
    expenses: [expense("2026-08-12", 30_000)],
  });
  const higher = calculateRetirementProjection({
    ...baseArgs(),
    budgets: [],
    expenses: [expense("2026-08-12", 60_000)],
  });

  assert.equal(lower.livingCostBaseline, 30_000);
  assert.equal(higher.livingCostBaseline, 60_000);
  assert.ok(higher.requiredCorpus > lower.requiredCorpus);
});

test("configured budgets drive current affordability instead of partial-month extrapolation", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    expenses: [expense("2026-09-02", 20_000)],
  });

  assert.equal(projection.actualAverageSpending, 300_000);
  assert.equal(projection.livingCostBaseline, 50_000);
  assert.equal(projection.cashFlowCostBaseline, 50_000);
  assert.equal(projection.availableSurplus, 50_000);
});

test("scheduled budget gaps do not fall back to actual spend", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    budgets: [{
      category: "Living",
      monthlyLimit: 0,
      windows: [{
        id: "future",
        monthlyLimit: 40_000,
        startDate: "2026-11-01",
        endMode: "lifelong",
      }],
    }],
    expenses: [expense("2026-08-12", 90_000)],
  });
  assert.equal(projection.baselineDriver, "budget");
  assert.equal(projection.livingCostBaseline, 0);
  assert.equal(projection.monthlyCashFlowTimeline[0].living, 0);
  assert.equal(projection.monthlyCashFlowTimeline[1].living, 0);
  assert.equal(projection.monthlyCashFlowTimeline[2].living, 40_000);
});

test("yearly budgets affect cash flow and retirement costs only in their due month", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    asOf: new Date(2026, 8, 1),
    assumptions: { ...baseArgs().assumptions, generalInflation: 0 },
    budgets: [{
      category: "Insurance",
      monthlyLimit: 0,
      windows: [{
        id: "premium",
        monthlyLimit: 80_000,
        cadence: "yearly",
        annualMonth: 10,
        endMode: "lifelong",
      }],
    }],
  });
  assert.equal(projection.monthlyCashFlowTimeline[0].living, 0);
  assert.equal(projection.monthlyCashFlowTimeline[1].living, 0);
  assert.equal(projection.monthlyCashFlowTimeline[2].living, 80_000);
  assert.equal(projection.monthlyCashFlowTimeline[3].living, 0);
  assert.ok(projection.requiredCorpus > 0);
});

test("bullet and interest-only loans schedule principal at maturity", () => {
  const bullet = loanPayoffDetails({
    id: "bullet", type: "Other", name: "Bullet", sanctionedPrincipal: 120_000,
    outstandingPrincipal: 120_000, annualInterestRate: 12, interestType: "Fixed",
    totalTenureMonths: 12, startDate: "2026-09-01", emi: 0, prepayments: 0,
    repaymentType: "bullet", createdAt: "2026-09-01",
  }, new Date(2026, 8, 1));
  assert.equal(bullet.remainingMonths, 12);
  assert.equal(bullet.totalInterestLeft, 14_400);

  const projection = calculateRetirementProjection({
    ...baseArgs(),
    loans: [{
      id: "io", type: "Other", name: "Interest only", sanctionedPrincipal: 120_000,
      outstandingPrincipal: 120_000, annualInterestRate: 12, interestType: "Fixed",
      totalTenureMonths: 2, startDate: "2026-09-01", emi: 1_200, prepayments: 0,
      repaymentType: "interest-only-plus-bullet", createdAt: "2026-09-01",
    }],
  });
  assert.equal(projection.monthlyCashFlowTimeline[0].loanEmi, 1_200);
  assert.equal(projection.monthlyCashFlowTimeline[1].loanEmi, 121_200);
});

test("a planned future expense increases the retirement shortfall impact", () => {
  const baseline = calculateRetirementProjection(baseArgs());
  const planned = calculateRetirementProjection({
    ...baseArgs(),
    plannedExpenses: [{
      id: "home", name: "Home", category: "Home", amount: 500_000,
      expectedDate: "2030-09-01", customInflationRate: 0, createdAt: "2026-09-01",
    }],
  });
  assert.ok(planned.plannedExpenseCorpusImpact > 0);
  assert.ok(planned.projectedCorpus < baseline.projectedCorpus);
  assert.ok(planned.gap > baseline.gap);
});

test("pre- and post-retirement windows affect only their active months", () => {
  const scheduled = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    assumptions: { ...baseArgs().assumptions, generalInflation: 0 },
    budgets: [{
      category: "Lifestyle",
      monthlyLimit: 0,
      windows: [
        {
          id: "working",
          monthlyLimit: 20_000,
          startDate: "2026-01-01",
          endMode: "retirement",
        },
        {
          id: "retired",
          monthlyLimit: 60_000,
          startDate: "2050-09-01",
          endMode: "lifelong",
        },
      ],
    }],
  });
  const lifelongWorking = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    assumptions: { ...baseArgs().assumptions, generalInflation: 0 },
    budgets: [{ category: "Lifestyle", monthlyLimit: 20_000 }],
  });
  assert.equal(scheduled.expenseAtRetirement, 60_000);
  assert.ok(scheduled.requiredCorpus > lifelongWorking.requiredCorpus);
});

test("retirement-ended budgets use the birth month when it differs from the as-of month", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    assumptions: {
      ...baseArgs().assumptions,
      dateOfBirth: "1990-01-15",
      generalInflation: 0,
    },
    budgets: [{
      category: "Housing",
      monthlyLimit: 10_000,
      windows: [
        {
          id: "working-rent",
          monthlyLimit: 10_000,
          startDate: "2026-01-01",
          endMode: "retirement",
        },
        {
          id: "retirement-home",
          monthlyLimit: 60_000,
          startDate: "2050-01-01",
          endMode: "lifelong",
        },
      ],
    }],
  });

  assert.equal(projection.monthsToRetirement, 280);
  assert.equal(projection.monthlyCashFlowTimeline.length, 280);
  assert.equal(projection.monthlyCashFlowTimeline.at(-1)?.living, 10_000);
  assert.equal(projection.expenseAtRetirement, 60_000);
});

test("readiness compares the current plan with investing the full surplus", () => {
  const readiness = calculateRetirementReadiness({
    ...baseArgs(),
    assumptions: {
      ...baseArgs().assumptions,
      targetRetirementAge: 45,
      monthlyContributionOverride: 0,
      investSurplus: false,
    },
  });

  assert.equal(readiness.targetAge, 45);
  assert.ok(readiness.extraSipRequiredAtTarget > 0);
  assert.ok(readiness.unallocatedSurplus > 0);
  assert.ok(
    readiness.fullSurplusRetirementAge !== null
      && (
        readiness.currentPlanRetirementAge === null
        || readiness.fullSurplusRetirementAge <= readiness.currentPlanRetirementAge
      ),
  );
});

test("recurring income contributes monthly while one-time income remains an unallocated opportunity", () => {
  const recurring = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({ amount: 100_000, recurring: true, frequency: "Monthly" })],
  });
  const oneTime = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({ amount: 20_000, recurring: false, frequency: "One-time" })],
  });
  const noIncome = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [],
  });

  assert.equal(recurring.netMonthlyIncome, 100_000);
  assert.equal(recurring.oneTimeIncomeBeforeRetirement, 0);
  assert.equal(oneTime.netMonthlyIncome, 0);
  assert.equal(oneTime.oneTimeIncomeBeforeRetirement, 20_000);
  assert.equal(oneTime.projectedCorpus, noIncome.projectedCorpus);
  assert.ok(recurring.projectedCorpus > oneTime.projectedCorpus);
});

test("income summaries exclude one-time and inactive sources from monthly cash flow", () => {
  assert.equal(calculateIncomeMetrics(income({
    amount: 120_000,
    recurring: false,
    frequency: "One-time",
  })).monthlyNet, 0);
  assert.equal(calculateIncomeMetrics(income({
    amount: 120_000,
    recurring: false,
    frequency: "Annual",
  })).monthlyNet, 0);
  const malformed = calculateIncomeMetrics(income({
    amount: Number.POSITIVE_INFINITY,
    recurring: true,
  }));
  assert.equal(malformed.monthlyNet, 0);
  Object.values(malformed).forEach((value) => assert.ok(Number.isFinite(value)));
});

test("non-recurring annual income is a single dated fund", () => {
  const withoutIncome = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [],
  });
  const withInactiveIncome = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({
      amount: 120_000,
      recurring: false,
      frequency: "Annual",
      date: "2027-01-01",
    })],
  });

  assert.equal(withInactiveIncome.netMonthlyIncome, 0);
  assert.equal(withInactiveIncome.oneTimeIncomeBeforeRetirement, 120_000);
  assert.equal(withInactiveIncome.datedFundOpportunities.length, 1);
  assert.equal(withInactiveIncome.datedFundOpportunities[0].kind, "one-time");
  assert.equal(withInactiveIncome.projectedCorpus, withoutIncome.projectedCorpus);
});

test("recurring income sources report independent weighted growth rates", () => {
  const largerSourceGrows = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [
      income({ id: "large", amount: 100_000, annualGrowthRate: 10 }),
      income({ id: "small", amount: 20_000, annualGrowthRate: 0 }),
    ],
  });
  const smallerSourceGrows = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [
      income({ id: "large", amount: 100_000, annualGrowthRate: 0 }),
      income({ id: "small", amount: 20_000, annualGrowthRate: 10 }),
    ],
  });

  assert.equal(largerSourceGrows.netMonthlyIncome, smallerSourceGrows.netMonthlyIncome);
  assert.ok(largerSourceGrows.effectiveIncomeGrowthRate > smallerSourceGrows.effectiveIncomeGrowthRate);
  assert.equal(largerSourceGrows.projectedCorpus, smallerSourceGrows.projectedCorpus);
});

test("recurring income growth changes only the informational surplus outlook", () => {
  const committedInvestment = {
    ...baseArgs().investments[0],
    monthlyContribution: 80_000,
  };
  const noGrowth = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({ amount: 100_000, annualGrowthRate: 0 })],
    investments: [committedInvestment],
  });
  const withGrowth = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({ amount: 100_000, annualGrowthRate: 10 })],
    investments: [committedInvestment],
  });

  assert.equal(noGrowth.netMonthlyIncome, withGrowth.netMonthlyIncome);
  assert.equal(withGrowth.projectedCorpus, noGrowth.projectedCorpus);
  assert.deepEqual(withGrowth.monthlyCashFlowTimeline, noGrowth.monthlyCashFlowTimeline);
  assert.ok(withGrowth.projectedYearlySurplusOutlook[1].surplus > noGrowth.projectedYearlySurplusOutlook[1].surplus);
});

test("recurring income growth steps up on its effective-date anniversary", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({
      amount: 100_000,
      annualGrowthRate: 12,
      date: "2026-04-01",
    })],
    investments: [],
    assumptions: {
      ...baseArgs().assumptions,
      generalInflation: 0,
    },
  });

  projection.monthlyCashFlowTimeline.forEach((entry) => {
    assert.equal(entry.income, 100_000);
  });
  assert.equal(projection.projectedYearlySurplusOutlook[0].income, 100_000);
  assert.ok(Math.abs(projection.projectedYearlySurplusOutlook[1].income - 112_000) < 0.01);
  assert.ok(Math.abs(projection.projectedYearlySurplusOutlook[2].income - 125_440) < 0.01);
});

test("monthly and yearly cash flow use the inflation-adjusted budget schedule", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({
      amount: 100_000,
      annualGrowthRate: 10,
      date: "2026-04-01",
    })],
    investments: [],
  });

  projection.monthlyCashFlowTimeline.forEach((entry) => {
    const living = 50_000 * Math.pow(1.06, Math.floor(entry.month / 12));
    assert.equal(entry.income, 100_000);
    assert.ok(Math.abs(entry.living - living) < 0.01);
    assert.ok(Math.abs(entry.surplus - (100_000 - living)) < 0.01);
  });
  assert.ok(Math.abs(projection.projectedYearlySurplusOutlook[1].income - 110_000) < 0.01);
  assert.ok(Math.abs(projection.projectedYearlySurplusOutlook[1].living - 53_000) < 0.01);
  assert.ok(Math.abs(projection.projectedYearlySurplusOutlook[1].surplus - 57_000) < 0.01);
  assert.equal(projection.surplusOpportunities[0].startDate.getMonth(), 8);
  assert.equal(projection.surplusOpportunities[0].monthlyAmount, 50_000);
});

test("current corpus and recurring contributions independently improve the projection", () => {
  const empty = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
  });
  const corpusOnly = calculateRetirementProjection({
    ...baseArgs(),
    investments: [{ ...baseArgs().investments[0], monthlyContribution: 0 }],
  });
  const corpusAndSip = calculateRetirementProjection(baseArgs());

  assert.ok(corpusOnly.projectedCorpus > empty.projectedCorpus);
  assert.ok(corpusAndSip.projectedCorpus > corpusOnly.projectedCorpus);
});

test("salary-linked PF growth appears only in the informational outlook", () => {
  const salarySource = income({
    id: "salary",
    type: "Salary",
    amount: 0,
    salaryDetails: {
      grossCTC: 120_000,
      basicPay: 10_000,
      hra: 0,
      allowances: 0,
      employeePF: 10_000,
      professionalTax: 0,
      tds: 0,
      otherDeductions: 0,
    },
  });
  const linkedInvestment = {
    ...baseArgs().investments[0],
    linkedIncomeSourceId: "salary",
    autoManagedContribution: true,
    monthlyContribution: 10_000,
  };
  const noGrowth = calculateRetirementProjection({
    ...baseArgs(),
    budgets: [],
    incomes: [{ ...salarySource, annualGrowthRate: 0 }],
    investments: [linkedInvestment],
  });
  const salaryGrowth = calculateRetirementProjection({
    ...baseArgs(),
    budgets: [],
    incomes: [{ ...salarySource, annualGrowthRate: 12 }],
    investments: [linkedInvestment],
  });

  assert.equal(noGrowth.netMonthlyIncome, 0);
  assert.equal(salaryGrowth.netMonthlyIncome, 0);
  assert.equal(noGrowth.linkedPFContribution, salaryGrowth.linkedPFContribution);
  assert.equal(salaryGrowth.projectedCorpus, noGrowth.projectedCorpus);
  assert.ok(
    salaryGrowth.projectedYearlySurplusOutlook[1].scheduledInvestments
      > noGrowth.projectedYearlySurplusOutlook[1].scheduledInvestments,
  );
});

test("investment card projection stops linked PF after salary expiry", () => {
  const linkedSalary = income({
    id: "linked-salary",
    type: "Salary",
    amount: 0,
    incomeEndMode: "custom",
    incomeEndDate: "2026-10-01",
    salaryDetails: {
      grossCTC: 0,
      basicPay: 100_000,
      hra: 0,
      allowances: 0,
      employeePF: 10_000,
      professionalTax: 0,
      tds: 0,
      otherDeductions: 0,
    },
  });
  const linkedPF = {
    ...baseArgs().investments[0],
    currentValue: 0,
    monthlyContribution: 10_000,
    expectedReturn: 0,
    linkedIncomeSourceId: linkedSalary.id,
    autoManagedContribution: true,
  };

  assert.equal(
    investmentProjectedValue(linkedPF, 1, {
      asOf: AS_OF,
      monthsToRetirement: 12,
      incomes: [linkedSalary],
    }),
    20_000,
  );
});

test("custom income end month is inclusive and expiry can create a shortfall", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    incomes: [income({
      amount: 100_000,
      incomeEndMode: "custom",
      incomeEndDate: "2026-10-01",
    })],
  });
  assert.equal(projection.monthlyCashFlowTimeline[0].income, 100_000);
  assert.equal(projection.monthlyCashFlowTimeline[1].income, 100_000);
  assert.equal(projection.monthlyCashFlowTimeline[2].income, 0);
  assert.equal(projection.firstCashFlowShortfall?.month, 2);
});

test("retirement-ended income remains available through the actionable accumulation timeline", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    incomes: [income({ amount: 100_000, incomeEndMode: "retirement" })],
  });
  assert.equal(projection.monthlyCashFlowTimeline[0].income, 100_000);
  assert.equal(projection.monthlyCashFlowTimeline.at(-1)?.income, 100_000);
});

test("auto-managed PF ignores links to non-salary income", () => {
  const nonSalaryIncome = income({
    id: "rental-income",
    type: "Rental",
    amount: 100_000,
  });
  const staleLinkedInvestment = {
    ...baseArgs().investments[0],
    linkedIncomeSourceId: "rental-income",
    autoManagedContribution: true,
    monthlyContribution: 10_000,
  };
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [nonSalaryIncome],
    investments: [staleLinkedInvestment],
  });

  assert.equal(projection.linkedPFContribution, 0);
});

test("one-time income ignores annual growth rates", () => {
  const withoutGrowth = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({ recurring: false, frequency: "One-time", annualGrowthRate: 0 })],
  });
  const withGrowth = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({ recurring: false, frequency: "One-time", annualGrowthRate: 50 })],
  });

  assert.equal(withGrowth.oneTimeIncomeBeforeRetirement, withoutGrowth.oneTimeIncomeBeforeRetirement);
  assert.equal(withGrowth.projectedCorpus, withoutGrowth.projectedCorpus);
});

test("one-time income is not assumed invested in the retirement corpus", () => {
  const zeroReturnInvestment = {
    ...baseArgs().investments[0],
    currentValue: 0,
    monthlyContribution: 0,
    expectedReturn: 0,
  };
  const withoutIncome = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [],
    investments: [zeroReturnInvestment],
  });
  const withIncome = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({
      amount: 20_000,
      recurring: false,
      frequency: "One-time",
      date: "2026-10-01",
    })],
    investments: [zeroReturnInvestment],
  });

  assert.equal(withIncome.datedFundOpportunities.length, 1);
  assert.equal(withIncome.datedFundOpportunities[0].amount, 20_000);
  assert.equal(withIncome.projectedCorpus, withoutIncome.projectedCorpus);
});

test("lump-sum availability includes only arrived one-time payments", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [
      income({ id: "past", amount: 10_000, frequency: "One-time", recurring: false, date: "2026-09-01" }),
      income({ id: "today", amount: 20_000, frequency: "One-time", recurring: false, date: "2026-09-02" }),
      income({ id: "future", amount: 40_000, frequency: "One-time", recurring: false, date: "2026-09-03" }),
      income({ id: "future-annual", amount: 80_000, frequency: "Annual", recurring: true, date: "2027-09-02" }),
    ],
  });

  assert.equal(projection.lumpSumAvailable, 30_000);
});

test("arrived annual funds accumulate from their anchor with anniversary-only growth", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({
      id: "annual",
      amount: 50_000,
      frequency: "Annual",
      recurring: true,
      annualGrowthRate: 10,
      date: "2024-09-02",
    })],
  });

  assert.ok(Math.abs(projection.lumpSumAvailable - 165_500) < 0.01);
  assert.ok(Math.abs(projection.datedFundOpportunities[0].amount - 60_500) < 0.01);
});

test("annual lump-sum custom expiry includes its final calendar month", () => {
  const throughExpiry = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({
      amount: 25_000,
      frequency: "Annual",
      recurring: true,
      date: "2023-09-30",
      incomeEndMode: "custom",
      incomeEndDate: "2025-09-01",
    })],
  });
  const beforeFirstOccurrence = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({
      amount: 25_000,
      frequency: "Annual",
      recurring: true,
      date: "2027-09-02",
      incomeEndMode: "custom",
      incomeEndDate: "2028-09-01",
    })],
  });

  assert.equal(throughExpiry.lumpSumAvailable, 75_000);
  assert.equal(beforeFirstOccurrence.lumpSumAvailable, 0);
});

test("invalid and zero dated funds cannot create lump-sum availability", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [
      income({ id: "invalid-date", amount: 10_000, frequency: "One-time", recurring: false, date: "2026-02-30" }),
      income({ id: "invalid-amount", amount: Number.POSITIVE_INFINITY, frequency: "One-time", recurring: false, date: "2026-09-01" }),
      income({ id: "zero", amount: 0, frequency: "Annual", recurring: true, date: "2024-09-02" }),
    ],
  });

  assert.equal(projection.lumpSumAvailable, 0);
  assert.ok(Number.isFinite(projection.lumpSumAvailable));
  assert.equal(projection.datedFundOpportunities.length, 0);
});

test("available lump sums remain separate from monthly cash flow and corpus", () => {
  const withoutLumpSum = calculateRetirementProjection(baseArgs());
  const withLumpSum = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [
      ...baseArgs().incomes,
      income({ amount: 250_000, frequency: "One-time", recurring: false, date: "2020-01-01" }),
    ],
  });

  assert.equal(withLumpSum.lumpSumAvailable, 250_000);
  assert.equal(withLumpSum.netMonthlyIncome, withoutLumpSum.netMonthlyIncome);
  assert.equal(withLumpSum.availableSurplus, withoutLumpSum.availableSurplus);
  assert.equal(withLumpSum.unallocatedSurplus, withoutLumpSum.unallocatedSurplus);
  assert.deepEqual(withLumpSum.monthlyCashFlowTimeline, withoutLumpSum.monthlyCashFlowTimeline);
  assert.equal(withLumpSum.currentSipCommitments, withoutLumpSum.currentSipCommitments);
  assert.equal(withLumpSum.currentCorpus, withoutLumpSum.currentCorpus);
  assert.equal(withLumpSum.projectedCorpus, withoutLumpSum.projectedCorpus);
});

test("only explicitly allocated one-time income enters the projected corpus", () => {
  const incomes = [income({
    id: "bonus",
    name: "Bonus",
    amount: 100_000,
    frequency: "One-time",
    recurring: false,
    date: "2027-01-15",
  })];
  const unallocated = calculateRetirementProjection({
    ...baseArgs(),
    incomes,
    investments: [],
  });
  const allocated = calculateRetirementProjection({
    ...baseArgs(),
    incomes,
    investments: [{
      id: "bonus-fund",
      name: "Bonus index fund",
      assetClass: "Mutual Funds",
      investedAmount: 0,
      currentValue: 0,
      monthlyContribution: 0,
      expectedReturn: 12,
      fundAllocations: [{
        id: "allocation-1",
        sourceId: "bonus",
        opportunityDate: "2027-01-15",
        investmentDate: "2027-01-15",
        amount: 40_000,
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
  });

  assert.ok(allocated.projectedCorpus > unallocated.projectedCorpus + 40_000);
  assert.equal(allocated.datedFundOpportunities[0].amount, 100_000);
});

test("a grown annual occurrence can be allocated up to its occurrence amount", () => {
  const incomes = [income({
    id: "annual-bonus",
    name: "Annual bonus",
    amount: 50_000,
    frequency: "Annual",
    recurring: true,
    annualGrowthRate: 10,
    date: "2024-09-02",
  })];
  const investment = {
    ...baseArgs().investments[0],
    currentValue: 0,
    monthlyContribution: 0,
    fundAllocations: [{
      id: "grown-allocation",
      sourceId: "annual-bonus",
      opportunityDate: "2026-09-02",
      investmentDate: "2026-09-02",
      amount: 60_500,
      createdAt: "2026-09-02T00:00:00.000Z",
    }],
  };
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes,
    investments: [investment],
  });

  assert.equal(projection.lumpSumAvailable, 105_000);
  assert.ok(projection.projectedCorpus > 60_500);
});

test("allocated lump sums use the target investment return in card and corpus projections", () => {
  const incomes = [income({
    id: "future-bonus",
    amount: 100_000,
    frequency: "One-time",
    recurring: false,
    date: "2027-01-15",
  })];
  const investment = {
    ...baseArgs().investments[0],
    currentValue: 0,
    monthlyContribution: 0,
    expectedReturn: 20,
    fundAllocations: [{
      id: "target-return-allocation",
      sourceId: "future-bonus",
      opportunityDate: "2027-01-15",
      investmentDate: "2027-01-15",
      amount: 100_000,
      createdAt: "2026-09-02T00:00:00.000Z",
    }],
  };
  const args = {
    ...baseArgs(),
    incomes,
    investments: [investment],
  };
  const projection = calculateRetirementProjection(args);
  const cardProjection = investmentProjectedValue(
    investment,
    projection.yearsToRetirement,
    {
      asOf: args.asOf,
      monthsToRetirement: projection.monthsToRetirement,
      incomes,
      legacySalaryGrowth: args.assumptions.salaryGrowth,
    },
  );

  assert.ok(Math.abs(projection.projectedCorpus - cardProjection) < 0.01);
});

test("what-if return overrides also apply to allocated future lump sums", () => {
  const incomes = [income({
    id: "scenario-bonus",
    amount: 100_000,
    frequency: "One-time",
    recurring: false,
    date: "2027-01-15",
  })];
  const investment = {
    ...baseArgs().investments[0],
    currentValue: 0,
    monthlyContribution: 0,
    expectedReturn: 20,
    fundAllocations: [{
      id: "scenario-allocation",
      sourceId: "scenario-bonus",
      opportunityDate: "2027-01-15",
      investmentDate: "2027-01-15",
      amount: 100_000,
      createdAt: "2026-09-02T00:00:00.000Z",
    }],
  };
  const args = {
    ...baseArgs(),
    incomes,
    investments: [investment],
  };

  const savedReturn = calculateRetirementProjection(args);
  const zeroReturn = calculateRetirementProjection({ ...args, portfolioReturnOverride: 0 });
  const scenarioReturn = calculateRetirementProjection({ ...args, portfolioReturnOverride: 12 });

  assert.ok(Math.abs(zeroReturn.projectedCorpus - 100_000) < 0.01);
  assert.ok(scenarioReturn.projectedCorpus > zeroReturn.projectedCorpus);
  assert.ok(savedReturn.projectedCorpus > scenarioReturn.projectedCorpus);
});

test("orphaned and over-allocated dated funds cannot inflate the projection", () => {
  const args = baseArgs();
  const invalidInvestment = {
    ...args.investments[0],
    currentValue: 0,
    monthlyContribution: 0,
    fundAllocations: [
      {
        id: "valid-part",
        sourceId: "bonus",
        opportunityDate: "2027-01-15",
        investmentDate: "2027-01-15",
        amount: 70_000,
        createdAt: "2026-01-01",
      },
      {
        id: "over-allocation",
        sourceId: "bonus",
        opportunityDate: "2027-01-15",
        investmentDate: "2027-01-15",
        amount: 40_000,
        createdAt: "2026-01-01",
      },
      {
        id: "orphan",
        sourceId: "deleted-source",
        opportunityDate: "2027-01-15",
        investmentDate: "2027-01-15",
        amount: 500_000,
        createdAt: "2026-01-01",
      },
    ],
  };
  const incomes = [income({
    id: "bonus",
    amount: 100_000,
    recurring: false,
    frequency: "One-time",
    date: "2027-01-15",
  })];
  const withoutInvalid = calculateRetirementProjection({
    ...args,
    incomes,
    investments: [{
      ...invalidInvestment,
      fundAllocations: [invalidInvestment.fundAllocations[0]],
    }],
  });
  const withInvalid = calculateRetirementProjection({
    ...args,
    incomes,
    investments: [invalidInvestment],
  });

  assert.equal(withInvalid.projectedCorpus, withoutInvalid.projectedCorpus);
});

test("lump-sum date-only boundaries use the local calendar day", () => {
  const asOf = new Date(2026, 8, 2, 0, 1);
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    asOf,
    incomes: [
      income({ id: "today", amount: 10_000, frequency: "One-time", recurring: false, date: "2026-09-02" }),
      income({ id: "tomorrow", amount: 20_000, frequency: "One-time", recurring: false, date: "2026-09-03" }),
    ],
  });

  assert.equal(projection.lumpSumAvailable, 10_000);
});

test("one-time income uses calendar months without becoming monthly cash flow", () => {
  const today = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    incomes: [
      income(),
      income({
        id: "today-windfall",
        amount: 20_000,
        recurring: false,
        frequency: "One-time",
        date: "2026-09-02",
      }),
    ],
  });
  const september = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    incomes: [
      income(),
      income({
        id: "september-windfall",
        amount: 20_000,
        recurring: false,
        frequency: "One-time",
        date: "2026-09-30",
      }),
    ],
  });
  const october = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    incomes: [
      income(),
      income({
        id: "october-windfall",
        amount: 20_000,
        recurring: false,
        frequency: "One-time",
        date: "2026-10-01",
      }),
    ],
  });

  assert.equal(today.monthlyCashFlowTimeline[0].income, 10_000);
  assert.equal(september.monthlyCashFlowTimeline[0].income, 10_000);
  assert.equal(september.monthlyCashFlowTimeline[1].income, 10_000);
  assert.equal(october.monthlyCashFlowTimeline[0].income, 10_000);
  assert.equal(october.monthlyCashFlowTimeline[1].income, 10_000);
  assert.equal(today.datedFundOpportunities[0].date.getDate(), 2);
  assert.equal(september.datedFundOpportunities[0].date.getMonth(), 8);
  assert.equal(october.datedFundOpportunities[0].date.getMonth(), 9);
});

test("annual income never enters recurring monthly income or SIP surplus", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    incomes: [income({
      id: "bonus",
      name: "Annual bonus",
      amount: 120_000,
      frequency: "Annual",
      recurring: true,
      date: "2026-10-31",
    })],
  });

  assert.equal(calculateIncomeMetrics(projection.datedFundOpportunities.length
    ? income({ amount: 120_000, frequency: "Annual", recurring: true })
    : income({})).monthlyNet, 0);
  assert.equal(projection.netMonthlyIncome, 0);
  assert.equal(projection.availableSurplus, 0);
  assert.equal(projection.surplusOpportunities.length, 0);
  assert.equal(projection.monthlyCashFlowTimeline[1].income, 0);
  assert.equal(projection.datedFundOpportunities[0].amount, 120_000);
});

test("recurring annual funds occur yearly and custom expiry month is inclusive", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({
      id: "bonus",
      name: "Annual bonus",
      amount: 50_000,
      frequency: "Annual",
      recurring: true,
      date: "2024-10-31",
      incomeEndMode: "custom",
      incomeEndDate: "2028-10-01",
    })],
  });

  assert.deepEqual(
    projection.datedFundOpportunities.map((event) => [
      event.date.getFullYear(),
      event.date.getMonth() + 1,
      event.date.getDate(),
    ]),
    [[2026, 10, 31], [2027, 10, 31], [2028, 10, 31]],
  );
  assert.ok(projection.datedFundOpportunities.every((event) => event.amount === 50_000));
});

test("a future recurring annual fund does not start before its entered year", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({
      id: "future-bonus",
      name: "Future annual bonus",
      amount: 50_000,
      frequency: "Annual",
      recurring: true,
      date: "2030-10-31",
    })],
  });

  assert.equal(projection.datedFundOpportunities[0].date.getFullYear(), 2030);
  assert.equal(projection.datedFundOpportunities[0].date.getMonth(), 9);
  assert.equal(projection.datedFundOpportunities[0].date.getDate(), 31);
});

test("annual fund growth steps only on each later annual occurrence", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({
      id: "bonus",
      amount: 50_000,
      frequency: "Annual",
      recurring: true,
      annualGrowthRate: 10,
      date: "2026-10-31",
    })],
  });

  assert.equal(projection.netMonthlyIncome, 0);
  assert.equal(projection.datedFundOpportunities[0].amount, 50_000);
  assert.equal(projection.datedFundOpportunities[0].estimated, false);
  assert.ok(Math.abs(projection.datedFundOpportunities[1].amount - 55_000) < 0.01);
  assert.equal(projection.datedFundOpportunities[1].estimated, true);
  assert.ok(Math.abs(projection.datedFundOpportunities[2].amount - 60_500) < 0.01);
  assert.equal(projection.projectedYearlySurplusOutlook[0].annualFunds, 50_000);
  assert.ok(Math.abs(projection.projectedYearlySurplusOutlook[1].annualFunds - 55_000) < 0.01);
});

test("a November annual bonus keeps X first, then steps to X plus growth next November", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [income({
      id: "november-bonus",
      type: "Bonus",
      amount: 100_000,
      frequency: "Annual",
      recurring: true,
      annualGrowthRate: 10,
      date: "2026-11-15",
    })],
  });

  const [first, second] = projection.datedFundOpportunities;
  assert.equal(first.date.getMonth(), 10);
  assert.equal(first.amount, 100_000);
  assert.equal(first.estimated, false);
  assert.equal(second.date.getFullYear(), first.date.getFullYear() + 1);
  assert.equal(second.date.getMonth(), 10);
  assert.ok(Math.abs(second.amount - 110_000) < 0.01);
  assert.equal(second.estimated, true);
});

test("multiple dated funds in one month remain separate opportunities", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [
      income({ id: "a", name: "Bonus", amount: 10_000, frequency: "Annual", recurring: false, date: "2026-10-01" }),
      income({ id: "b", name: "Gift", amount: 20_000, frequency: "One-time", recurring: false, date: "2026-10-31" }),
    ],
  });

  assert.equal(projection.datedFundOpportunities.length, 2);
  assert.deepEqual(projection.datedFundOpportunities.map((event) => event.sourceName), ["Bonus", "Gift"]);
  assert.equal(projection.surplusOpportunities.length, 0);
});

test("EMI outflow stops at the modeled loan payoff", () => {
  const shortLoan = calculateRetirementProjection({
    ...baseArgs(),
    loans: [loan()],
  });
  const longLoan = calculateRetirementProjection({
    ...baseArgs(),
    loans: [loan({ outstandingPrincipal: 6_000_000, totalTenureMonths: 600 })],
  });

  assert.equal(remainingLoanMonths(loan(), AS_OF), 12);
  assert.equal(shortLoan.requiredCorpus, calculateRetirementProjection(baseArgs()).requiredCorpus);
  assert.ok(longLoan.requiredCorpus > shortLoan.requiredCorpus);
});

test("prepayment history is not subtracted from the authoritative outstanding balance", () => {
  assert.equal(remainingLoanMonths(loan(), AS_OF), 12);
  assert.equal(remainingLoanMonths(loan({ prepayments: 60_000 }), AS_OF), 12);
  assert.equal(
    remainingLoanMonths(loan({
      outstandingPrincipal: 800_000,
      prepayments: 100_000,
      emi: 10_000,
      totalTenureMonths: 120,
    }), AS_OF),
    80,
  );
});

test("full loan prepayments remove the EMI from the retirement forecast", () => {
  const fullyPrepaid = loan({ outstandingPrincipal: 0, prepayments: 120_000 });
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    loans: [fullyPrepaid],
  });

  assert.equal(remainingLoanMonths(fullyPrepaid, AS_OF), 0);
  assert.equal(projection.activeEmi, 0);
  assert.equal(projection.availableSurplus, calculateRetirementProjection(baseArgs()).availableSurplus);
});

test("a lower outstanding balance releases surplus from the earlier payoff month", () => {
  const assumptions = {
    ...baseArgs().assumptions,
    dateOfBirth: "1990-09-02",
    targetRetirementAge: 37,
    lifeExpectancy: 38,
    generalInflation: 0,
    salaryGrowth: 0,
    monthlyContributionOverride: 50_000,
  };
  const investment = {
    ...baseArgs().investments[0],
    currentValue: 0,
    monthlyContribution: 50_000,
    expectedReturn: 0,
  };
  const withoutPrepayment = calculateRetirementProjection({
    ...baseArgs(),
    assumptions,
    investments: [investment],
    loans: [loan()],
  });
  const withPrepayment = calculateRetirementProjection({
    ...baseArgs(),
    assumptions,
    investments: [investment],
    loans: [loan({ outstandingPrincipal: 60_000, prepayments: 60_000 })],
  });

  assert.ok(withPrepayment.projectedCorpus > withoutPrepayment.projectedCorpus);
});

test("paid-off loans do not consume monthly cash flow", () => {
  const paidOff = calculateRetirementProjection({
    ...baseArgs(),
    loans: [loan({ outstandingPrincipal: 0 })],
  });
  const active = calculateRetirementProjection({
    ...baseArgs(),
    loans: [loan()],
  });

  assert.equal(remainingLoanMonths(loan({ outstandingPrincipal: 0 }), AS_OF), 0);
  assert.equal(paidOff.activeEmi, 0);
  assert.equal(active.activeEmi, 10_000);
  assert.ok(active.availableSurplus < paidOff.availableSurplus);
});

test("a ledger EMI linked to an active loan is not counted in living expenses", () => {
  const activeLoan = loan();
  const regular = expense("2026-08-10", 30_000);
  const emi = {
    ...expense("2026-08-12", 10_000),
    merchant: "Bank EMI",
    linkedLoanId: activeLoan.id,
  };

  const result = calculateActualMonthlyAverage([regular, emi], AS_OF, [activeLoan]);

  assert.equal(result.average, 30_000);
});

test("retirement surplus subtracts a tracked EMI exactly once", () => {
  const activeLoan = loan();
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    budgets: [],
    loans: [activeLoan],
    expenses: [
      expense("2026-08-10", 30_000),
      { ...expense("2026-08-12", 10_000), linkedLoanId: activeLoan.id },
    ],
  });

  assert.equal(projection.cashFlowCostBaseline, 30_000);
  assert.equal(projection.activeEmi, 10_000);
  assert.equal(projection.availableSurplus, 60_000);
});

test("a linked EMI remains excluded from living costs after its loan is paid off", () => {
  const paidOffLoan = loan({ outstandingPrincipal: 0 });
  const result = calculateActualMonthlyAverage([
    expense("2026-08-10", 30_000),
    { ...expense("2026-08-12", 10_000), linkedLoanId: paidOffLoan.id },
  ], AS_OF, [paidOffLoan]);

  assert.equal(result.average, 30_000);
});

test("a linked EMI remains excluded from living costs when its loan is unavailable", () => {
  const result = calculateActualMonthlyAverage([
    expense("2026-08-10", 30_000),
    { ...expense("2026-08-12", 10_000), linkedLoanId: "deleted-loan" },
  ], AS_OF, []);

  assert.equal(result.average, 30_000);
});

test("projection uses the canonical birthday-based planning timeline", () => {
  const dates = [
    ["before", new Date("2026-09-01T12:00:00.000Z"), 35, 288],
    ["on", new Date("2026-09-02T12:00:00.000Z"), 36, 288],
    ["after", new Date("2026-09-03T12:00:00.000Z"), 36, 288],
  ] as const;

  dates.forEach(([, asOf, expectedAge, expectedMonths]) => {
    const projection = calculateRetirementProjection({
      ...baseArgs(),
      asOf,
      assumptions: { ...baseArgs().assumptions, dateOfBirth: "1990-09-02", targetRetirementAge: 60 },
    });
    assert.equal(projection.currentAge, expectedAge);
    assert.equal(projection.monthsToRetirement, expectedMonths);
  });
});

test("legacy loan EMI text is excluded when its amount matches an active loan", () => {
  const result = calculateActualMonthlyAverage([
    expense("2026-08-10", 30_000),
    { ...expense("2026-08-12", 10_000), note: "Monthly loan EMI" },
  ], AS_OF, [loan()]);

  assert.equal(result.average, 30_000);
});

test("historical spending replay classifies loans using the saved as-of date", () => {
  const historicalAsOf = new Date("2025-03-31T12:00:00.000Z");
  const result = calculateActualMonthlyAverage([
    { ...expense("2025-03-12", 10_000), note: "Monthly loan EMI" },
  ], historicalAsOf, [loan({ startDate: "2026-01-01" })]);

  assert.equal(result.average, 10_000);
});

test("a legitimate expense matching an EMI amount remains in living expenses", () => {
  const result = calculateActualMonthlyAverage([
    expense("2026-08-10", 30_000),
    { ...expense("2026-08-12", 10_000), merchant: "Hospital", note: "Dental care" },
  ], AS_OF, [loan()]);

  assert.equal(result.average, 40_000);
});

test("sparse expense history averages observed months instead of inserting zero months", () => {
  const result = calculateActualMonthlyAverage([
    expense("2026-06-12", 30_000),
    expense("2026-08-12", 50_000),
  ], AS_OF);

  assert.equal(result.monthsUsed, 2);
  assert.equal(result.average, 40_000);
  assert.equal(result.method, "2-month completed average");
});

test("uninvested surplus defaults to zero additional SIP", () => {
  const projection = calculateRetirementProjection(baseArgs());

  assert.equal(projection.availableSurplus, 50_000);
  assert.equal(projection.nonLinkedSipCommitments, 10_000);
  assert.equal(projection.unallocatedSurplus, 40_000);
  assert.equal(projection.selectedTakeHomeInvestment, 0);
  assert.equal(projection.modeledMonthlyContribution, 10_000);
});

test("explicit SIP invests from surplus remaining after existing commitments", () => {
  const selected = calculateRetirementProjection({
    ...baseArgs(),
    assumptions: {
      ...baseArgs().assumptions,
      investSurplus: false,
      monthlyContributionOverride: 30_000,
    },
  });

  assert.equal(selected.availableSurplus, 50_000);
  assert.equal(selected.unallocatedSurplus, 40_000);
  assert.equal(selected.selectedTakeHomeInvestment, 30_000);
  assert.equal(selected.modeledTakeHomeContribution, 40_000);
  assert.equal(selected.modeledMonthlyContribution, 40_000);
  assert.equal(selected.contributionAffordable, true);
});

test("additional SIP above unallocated surplus shows an affordability warning", () => {
  const selected = calculateRetirementProjection({
    ...baseArgs(),
    assumptions: {
      ...baseArgs().assumptions,
      investSurplus: false,
      monthlyContributionOverride: 45_000,
    },
  });

  assert.equal(selected.unallocatedSurplus, 40_000);
  assert.equal(selected.selectedTakeHomeInvestment, 45_000);
  assert.equal(selected.effectiveTakeHomeInvestment, 45_000);
  assert.equal(selected.modeledTakeHomeContribution, 55_000);
  assert.equal(selected.modeledMonthlyContribution, 55_000);
  assert.equal(selected.contributionAffordable, false);
  assert.match(selected.affordabilityWarning ?? "", /5,000/);
});

test("a sub-rupee affordability difference does not show a zero-value warning", () => {
  const selected = calculateRetirementProjection({
    ...baseArgs(),
    incomes: [{
      ...baseArgs().incomes[0],
      amount: 100_000.49,
    }],
    assumptions: {
      ...baseArgs().assumptions,
      monthlyContributionOverride: 40_000.75,
    },
  });

  assert.equal(selected.contributionAffordable, true);
  assert.equal(selected.affordabilityWarning, null);
});

test("immediate retirement reports a lump sum instead of a zero SIP", () => {
  const immediate = calculateRetirementProjection({
    ...baseArgs(),
    assumptions: {
      ...baseArgs().assumptions,
      dateOfBirth: "1996-09-02",
      targetRetirementAge: 30,
      lifeExpectancy: 85,
    },
  });

  assert.equal(immediate.monthsToRetirement, 0);
  assert.ok(immediate.gap > 0);
  assert.equal(immediate.extraSipRequired, 0);
  assert.equal(immediate.requiredLumpSumToday, immediate.gap);
});

test("chart shows the confirmed monthly lifestyle expense at each age", () => {
  const projection = calculateRetirementProjection(baseArgs());
  const firstPoint = projection.chartData[0];
  const retirementPoint = projection.chartData.find(
    (point) => point.age === projection.targetAge,
  );

  assert.equal(firstPoint["Monthly Lifestyle Expense"], projection.livingCostBaseline);
  assert.ok(retirementPoint);
  assert.ok(
    Math.abs(
      Number(retirementPoint["Monthly Lifestyle Expense"]) - projection.expenseAtRetirement,
    ) < 0.01,
  );
  assert.ok(
    Math.abs(
      Number(retirementPoint["Lifestyle Corpus Needed"]) - projection.requiredCorpus,
    ) < 0.01,
  );
  assert.equal(
    projection.chartData.at(-1)?.["Lifestyle Corpus Needed"],
    0,
  );
});

test("required corpus and base drawdown use the same inflation-adjusted outflows", () => {
  const assumptions = {
    ...baseArgs().assumptions,
    targetRetirementAge: 36,
    lifeExpectancy: 37,
    generalInflation: 12,
    monthlyContributionOverride: 0,
  };
  const requirement = calculateRetirementProjection({
    ...baseArgs(),
    assumptions,
    incomes: [],
    investments: [],
  });
  const funded = calculateRetirementProjection({
    ...baseArgs(),
    assumptions,
    incomes: [],
    investments: [{
      ...baseArgs().investments[0],
      currentValue: requirement.requiredCorpus,
      monthlyContribution: 0,
      expectedReturn: 0,
    }],
  });

  assert.ok(Number(funded.chartData.at(-1)?.["Base Scenario"]) < 0.01);
});

test("invalid dates, ages, and numeric values never produce NaN or Infinity", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    expenses: [expense("not-a-date", Number.NaN), expense("2026-08-01", Number.POSITIVE_INFINITY)],
    budgets: [{ category: "Living", monthlyLimit: Number.NaN }],
    incomes: [income({ amount: Number.POSITIVE_INFINITY, date: "not-a-date" })],
    investments: [{
      ...baseArgs().investments[0],
      currentValue: Number.NaN,
      monthlyContribution: Number.POSITIVE_INFINITY,
      expectedReturn: Number.NEGATIVE_INFINITY,
    }],
    loans: [loan({ outstandingPrincipal: Number.NaN, emi: Number.POSITIVE_INFINITY })],
    assumptions: {
      dateOfBirth: "not-a-date",
      targetRetirementAge: Number.NaN,
      lifeExpectancy: Number.POSITIVE_INFINITY,
      generalInflation: Number.NaN,
      salaryGrowth: Number.NEGATIVE_INFINITY,
      monthlyContributionOverride: Number.POSITIVE_INFINITY,
      investSurplus: true,
    },
  });

  assert.equal(projection.assumptionsValid, false);
  for (const [key, value] of Object.entries(projection)) {
    if (typeof value === "number") {
      assert.ok(Number.isFinite(value), `${key} must be finite`);
    }
  }
  for (const point of projection.chartData) {
    for (const [key, value] of Object.entries(point)) {
      if (typeof value === "number") {
        assert.ok(Number.isFinite(value), `chartData.${key} must be finite`);
      }
    }
  }
});

const assertAllNumbersFinite = (value: unknown, path = "result"): void => {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must be finite`);
    return;
  }
  if (!value || typeof value !== "object" || value instanceof Date) return;
  Object.entries(value).forEach(([key, item]) => assertAllNumbersFinite(item, `${path}.${key}`));
};

test("empty and partial retirement data returns a bounded finite projection", () => {
  const empty = calculateRetirementProjection({
    expenses: [],
    budgets: [],
    incomes: [],
    investments: [],
    loans: [],
    assumptions: {} as RetirementProjectionArgs["assumptions"],
    asOf: AS_OF,
  });
  const partial = calculateRetirementProjection({
    ...baseArgs(),
    expenses: undefined,
    budgets: undefined,
    incomes: undefined,
    investments: undefined,
    loans: undefined,
    assumptions: undefined,
  } as unknown as RetirementProjectionArgs);

  assertAllNumbersFinite(empty);
  assertAllNumbersFinite(partial);
  assert.ok(empty.monthlyCashFlowTimeline.length <= 125 * 12);
  assert.ok(partial.chartData.length <= 126);
});

test("malformed records and invalid planning date do not crash the projection", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    asOf: new Date(Number.NaN),
    expenses: [null],
    budgets: [null],
    incomes: [null],
    investments: [null],
    loans: [null],
  } as unknown as RetirementProjectionArgs);

  assertAllNumbersFinite(projection);
  assert.ok(projection.monthlyCashFlowTimeline.length <= 125 * 12);
});

test("Infinity, NaN, and extreme finite values produce finite bounded results", () => {
  const huge = Number.MAX_VALUE;
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    budgets: [{ category: "Living", monthlyLimit: huge }],
    incomes: [income({ amount: huge, annualGrowthRate: huge })],
    investments: [{
      ...baseArgs().investments[0],
      investedAmount: huge,
      currentValue: huge,
      monthlyContribution: huge,
      expectedReturn: huge,
    }],
    loans: [loan({
      sanctionedPrincipal: huge,
      outstandingPrincipal: huge,
      emi: huge,
      annualInterestRate: huge,
      totalTenureMonths: huge,
    })],
    assumptions: {
      dateOfBirth: "0001-01-01",
      targetRetirementAge: Number.POSITIVE_INFINITY,
      lifeExpectancy: huge,
      generalInflation: huge,
      salaryGrowth: Number.NaN,
      monthlyContributionOverride: huge,
      investSurplus: true,
    },
  });

  assertAllNumbersFinite(projection);
  assert.ok(projection.monthlyCashFlowTimeline.length <= 125 * 12);
  assert.ok(projection.chartData.length <= 126);
  assert.ok(Number.isFinite(investmentProjectedValue(
    { ...baseArgs().investments[0], currentValue: huge, monthlyContribution: huge, expectedReturn: huge },
    Number.POSITIVE_INFINITY,
    { monthsToRetirement: Number.POSITIVE_INFINITY },
  )));
  assert.ok(Number.isFinite(portfolioAllocationPercent(huge, Number.POSITIVE_INFINITY)));
});

test("scheduled SIPs start in their calendar month and remain feasible after a loan payoff", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    assumptions: { ...baseArgs().assumptions, generalInflation: 0, salaryGrowth: 0 },
    investments: [{
      ...baseArgs().investments[0],
      monthlyContribution: 20_000,
      contributionStartDate: "2027-09-01",
      contributionEndMode: "retirement",
    }],
    loans: [loan({ outstandingPrincipal: 10_000, totalTenureMonths: 1 })],
  });
  assert.equal(projection.monthlyCashFlowTimeline[0].scheduledInvestments, 0);
  assert.equal(projection.monthlyCashFlowTimeline[12].scheduledInvestments, 20_000);
  assert.equal(projection.cashFlowFeasible, true);
});

test("a future loan is excluded today and creates a future cash-flow shortfall", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    loans: [loan({
      startDate: "2026-11-01",
      sanctionedPrincipal: 120_000,
      outstandingPrincipal: 0,
      emi: 60_000,
      totalTenureMonths: 2,
    })],
  });
  assert.equal(projection.activeEmi, 0);
  assert.equal(projection.monthlyCashFlowTimeline[0].loanEmi, 0);
  assert.equal(projection.monthlyCashFlowTimeline[2].loanEmi, 60_000);
  assert.equal(projection.cashFlowFeasible, false);
  assert.equal(projection.firstCashFlowShortfall?.month, 2);
});

test("custom contribution end month is inclusive while retirement schedules stop before retirement", () => {
  const custom = calculateRetirementProjection({
    ...baseArgs(),
    investments: [{
      ...baseArgs().investments[0],
      contributionStartDate: "2026-10-01",
      contributionEndMode: "custom",
      contributionEndDate: "2026-11-01",
    }],
  });
  assert.equal(custom.monthlyCashFlowTimeline[0].scheduledInvestments, 0);
  assert.equal(custom.monthlyCashFlowTimeline[1].scheduledInvestments, 10_000);
  assert.equal(custom.monthlyCashFlowTimeline[2].scheduledInvestments, 10_000);
  assert.equal(custom.monthlyCashFlowTimeline[3].scheduledInvestments, 0);
  const retirement = calculateRetirementProjection(baseArgs());
  assert.equal(retirement.monthlyCashFlowTimeline.at(-1)?.scheduledInvestments, 10_000);
});

test("loan payoff releases EMI capacity in the following month", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    loans: [loan({ outstandingPrincipal: 10_000, emi: 10_000, totalTenureMonths: 1 })],
  });
  assert.equal(projection.monthlyCashFlowTimeline[0].loanEmi, 10_000);
  assert.equal(projection.monthlyCashFlowTimeline[1].loanEmi, 0);
  assert.ok(projection.surplusOpportunities.some((opportunity) => /payoff/.test(opportunity.reason)));
});

test("a loan starting later this month is not due today and starts next modeled month", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    investments: [],
    loans: [loan({
      startDate: "2026-09-30",
      outstandingPrincipal: 20_000,
      emi: 10_000,
      totalTenureMonths: 2,
    })],
  });
  assert.equal(projection.activeEmi, 0);
  assert.equal(projection.monthlyCashFlowTimeline[0].loanEmi, 0);
  assert.equal(projection.monthlyCashFlowTimeline[1].loanEmi, 10_000);
  assert.equal(loanPayoffDetails(loan({
    startDate: "2026-09-30",
    outstandingPrincipal: 0,
    sanctionedPrincipal: 20_000,
    emi: 10_000,
  }), AS_OF).remainingMonths, 2);
});

test("a SIP starting later this month does not reduce today's goal surplus", () => {
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    investments: [{
      ...baseArgs().investments[0],
      contributionStartDate: "2026-09-28",
      monthlyContribution: 20_000,
    }],
  });
  assert.equal(projection.monthlyCashFlowTimeline[0].scheduledInvestments, 0);
  assert.equal(projection.nonLinkedSipCommitments, 0);
  assert.equal(projection.unallocatedSurplus, 50_000);
  assert.equal(projection.monthlyCashFlowTimeline[1].scheduledInvestments, 20_000);
});

test("date-only schedule boundaries retain their local calendar day", () => {
  const asOf = new Date(2026, 8, 2, 23, 30);
  const projection = calculateRetirementProjection({
    ...baseArgs(),
    asOf,
    assumptions: { ...baseArgs().assumptions, generalInflation: 0, salaryGrowth: 0 },
    investments: [{
      ...baseArgs().investments[0],
      contributionStartDate: "2026-09-02",
      contributionEndMode: "custom",
      contributionEndDate: "2026-09-02",
    }],
  });
  assert.equal(projection.monthlyCashFlowTimeline[0].scheduledInvestments, 10_000);
  assert.equal(projection.monthlyCashFlowTimeline[1].scheduledInvestments, 0);
});
