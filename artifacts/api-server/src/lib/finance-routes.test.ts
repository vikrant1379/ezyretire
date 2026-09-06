import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  budgetsTable,
  db,
  expensesTable,
  salaryDetailsTable,
  userProfilesTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import express, { type Request } from "express";
import financeRouter from "../routes/finance.js";

test("financial data routes persist and reset data", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `finance-route-${unique}`;
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = {
      id: userId,
      email: `${userId}@example.test`,
      isAdmin: false,
    } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const initial = await fetch(`http://127.0.0.1:${port}/api/financial-data`);
    assert.equal(initial.status, 200);
    const initialBody = await initial.json() as { expenses: unknown[]; loans: unknown[] };
    assert.deepEqual(initialBody.expenses, []);
    assert.deepEqual(initialBody.loans, []);

    const payload = {
      expenses: [
        {
          id: `exp-${unique}`,
          amount: 2999,
        },
      ],
      budgets: [
        {
          category: "Food",
          monthlyLimit: 20000,
          schedules: [
            {
              id: `budget-window-custom-${unique}`,
              amount: 18000,
              startMonth: "2026-04",
              endMode: "custom",
              endMonth: "2028-03",
              note: "Before school",
            },
            {
              id: `budget-window-retirement-${unique}`,
              amount: 24000,
              startMonth: "2028-04",
              endMode: "retirement",
            },
            {
              id: `budget-window-lifelong-${unique}`,
              amount: 30000,
              startMonth: "2040-01",
              endMode: "lifelong",
              note: "Long term",
            },
          ],
        },
        { category: "Household", monthlyLimit: 12000 },
      ],
      incomeSources: [
        {
          id: `inc-${unique}`,
          amount: 100000,
          frequency: "Monthly",
          recurring: false,
          incomeEndMode: "custom",
          incomeEndDate: "2035-06-30",
        },
        {
          id: `legacy-annual-once-${unique}`,
          amount: 50000,
          frequency: "Annual",
          recurring: false,
          date: "2030-04-01",
          annualGrowthRate: 12,
          incomeEndMode: "custom",
          incomeEndDate: "2035-06-30",
        },
        {
          id: `legacy-annual-salary-${unique}`,
          type: "Salary",
          amount: 120000,
          frequency: "Annual",
          recurring: true,
          date: "2020-04-01",
          incomeEndMode: "custom",
          incomeEndDate: "2035-06-30",
          salaryDetails: {
            grossCTC: 1200000,
            grossCTCMode: "automatic",
            basicPay: 720000,
            hra: 240000,
            allowances: 240000,
            employeePF: 72000,
            professionalTax: 2400,
            tds: 120000,
            tdsMode: "automatic",
            taxRegime: "new",
            financialYear: "2025-26",
            taxRuleVersion: "india-fy2025-26-v1",
            otherDeductions: 0,
          },
        },
        {
          id: `growing-annual-bonus-${unique}`,
          name: "Growing annual bonus",
          type: "Bonus",
          amount: 50000,
          frequency: "Annual",
          recurring: true,
          date: "2024-09-02",
          annualGrowthRate: 10,
        },
      ],
      investments: [{
        id: `inv-${unique}`,
        currentValue: 400000,
        fundAllocations: [
          {
            id: "allocation-1",
            sourceId: `legacy-annual-once-${unique}`,
            opportunityDate: "2030-04-01",
            investmentDate: "2030-04-02",
            amount: 25000,
            createdAt: "2026-09-04T00:00:00.000Z",
          },
          {
            id: "allocation-grown-annual",
            sourceId: `growing-annual-bonus-${unique}`,
            opportunityDate: "2026-09-02",
            investmentDate: "2026-09-02",
            amount: 60500,
            createdAt: "2026-09-04T00:00:00.000Z",
          },
          {
            id: "allocation-1",
            sourceId: `growing-annual-bonus-${unique}`,
            opportunityDate: "2026-09-02",
            investmentDate: "2026-09-02",
            amount: 1,
          },
          {
            id: "allocation-orphan",
            sourceId: "missing-income",
            opportunityDate: "2026-09-02",
            investmentDate: "2026-09-02",
            amount: 1,
          },
          {
            id: "allocation-too-early",
            sourceId: `growing-annual-bonus-${unique}`,
            opportunityDate: "2026-09-02",
            investmentDate: "2026-09-01",
            amount: 1,
          },
          {
            id: "allocation-over",
            sourceId: `growing-annual-bonus-${unique}`,
            opportunityDate: "2026-09-02",
            investmentDate: "2026-09-03",
            amount: 1,
          },
        ],
        disposals: [{
          id: "sale-1",
          name: "Listed share sale",
          purchaseDate: "2024-01-15",
          saleDate: "2026-08-20",
          costBasis: 100000,
          proceeds: 180000,
          assetType: "Listed Equity",
          eligibleExemption: 10000,
          indexedCostBasis: 120000,
          grandfatheredValue: 150000,
        }],
      }],
      loans: [{ id: `loan-${unique}`, outstandingPrincipal: 500000 }],
      retirementInputs: {
        dateOfBirth: "1991-05-09",
        targetRetirementAge: 57,
        lifeExpectancy: 88,
        generalInflation: 5.5,
        salaryGrowth: 9.25,
        monthlyContributionOverride: 25000,
        investSurplus: true,
      },
      profileInputs: {
        fullName: "Finance Route User",
        gender: "Male",
        phone: "9999999999",
        onboardingCompleted: true,
        dateOfBirth: "1991-05-09",
        targetRetirementAge: 57,
        lifeExpectancy: 88,
        riskPreference: "Growth",
      },
    };

    const persisted = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(persisted.status, 200);
    const persistedBody = await persisted.json() as {
      profileInputs: { riskPreference: string; fullName?: string };
      retirementInputs: { targetRetirementAge: number };
      expenses: unknown[];
      budgets: Array<{
        category: string;
        monthlyLimit: number;
        schedules: Array<{
          id: string;
          amount: number;
          startMonth: string;
          endMode: string;
          endMonth?: string;
          note?: string;
        }>;
        windows: Array<{
          id: string;
          monthlyLimit: number;
          startDate?: string;
          endMode: string;
          endDate?: string;
        }>;
      }>;
      incomeSources: Array<{
        frequency: string;
        recurring: boolean;
        annualGrowthRate?: number;
        incomeEndMode: string;
        incomeEndDate?: string;
        amount: number;
        salaryDetails?: {
          grossCTC: number;
          grossCTCMode: string;
          basicPay: number;
          employeePF: number;
          tds: number;
          tdsMode: string;
          taxRegime?: string;
          financialYear?: string;
          taxRuleVersion?: string;
        };
      }>;
      investments: Array<{
        fundAllocations?: Array<{
          id: string;
          sourceId: string;
          opportunityDate: string;
          amount: number;
          investmentDate: string;
        }>;
        disposals?: Array<{
          id: string;
          name: string;
          purchaseDate?: string;
          saleDate?: string;
          costBasis?: number;
          proceeds?: number;
          assetType?: string;
          eligibleExemption?: number;
          indexedCostBasis?: number;
          grandfatheredValue?: number;
        }>;
      }>;
      uiPreferences: { investmentOrder: string[]; investmentSort: { by: string } };
    };
    assert.equal(persistedBody.retirementInputs.targetRetirementAge, 57);
    assert.equal(persistedBody.profileInputs.riskPreference, "Growth");
    assert.equal(persistedBody.profileInputs.fullName, "Finance Route User");
    assert.equal(persistedBody.expenses.length, 1);
    assert.deepEqual(persistedBody.budgets[0].schedules, payload.budgets[0].schedules);
    assert.deepEqual(persistedBody.budgets[0].windows, [
      {
        id: `budget-window-custom-${unique}`,
        monthlyLimit: 18000,
        startDate: "2026-04-01",
        endMode: "custom",
        endDate: "2028-03-01",
        note: "Before school",
      },
      {
        id: `budget-window-retirement-${unique}`,
        monthlyLimit: 24000,
        startDate: "2028-04-01",
        endMode: "retirement",
      },
      {
        id: `budget-window-lifelong-${unique}`,
        monthlyLimit: 30000,
        startDate: "2040-01-01",
        endMode: "lifelong",
        note: "Long term",
      },
    ]);
    assert.equal(persistedBody.budgets[1].monthlyLimit, 12000);
    assert.deepEqual(
      persistedBody.budgets[1].schedules.map(({ id: _id, ...schedule }) => schedule),
      [{ amount: 12000, startMonth: "1900-01", endMode: "lifelong" }],
    );
    assert.ok(persistedBody.budgets[1].schedules[0].id);
    assert.deepEqual(
      persistedBody.budgets[1].windows.map(({ id: _id, ...window }) => window),
      [{ monthlyLimit: 12000, endMode: "lifelong" }],
    );
    assert.equal(persistedBody.incomeSources[0].incomeEndMode, "custom");
    assert.equal(persistedBody.incomeSources[0].incomeEndDate, "2035-06-30");
    assert.equal(persistedBody.incomeSources[0].recurring, true);
    assert.equal(persistedBody.incomeSources[1].frequency, "One-time");
    assert.equal(persistedBody.incomeSources[1].recurring, false);
    assert.equal(persistedBody.incomeSources[1].annualGrowthRate, undefined);
    assert.equal(persistedBody.incomeSources[1].incomeEndDate, undefined);
    const migratedSalary = persistedBody.incomeSources[2];
    assert.equal(migratedSalary.frequency, "Monthly");
    assert.equal(migratedSalary.recurring, true);
    assert.equal(migratedSalary.amount, 10000);
    assert.equal(migratedSalary.salaryDetails?.grossCTC, 1200000);
    assert.equal(migratedSalary.salaryDetails?.grossCTCMode, "automatic");
    assert.equal(migratedSalary.salaryDetails?.basicPay, 60000);
    assert.equal(migratedSalary.salaryDetails?.employeePF, 6000);
    assert.equal(migratedSalary.salaryDetails?.tds, 10000);
    assert.equal(migratedSalary.salaryDetails?.tdsMode, "automatic");
    assert.equal(migratedSalary.salaryDetails?.taxRegime, "new");
    assert.equal(migratedSalary.salaryDetails?.financialYear, "2025-26");
    assert.equal(migratedSalary.salaryDetails?.taxRuleVersion, "india-fy2025-26-v1");

    const reloaded = await fetch(`http://127.0.0.1:${port}/api/financial-data`);
    const reloadedBody = await reloaded.json() as {
      budgets: typeof persistedBody.budgets;
      incomeSources: typeof persistedBody.incomeSources;
      investments: typeof persistedBody.investments;
    };
    assert.deepEqual(reloadedBody.incomeSources[2], migratedSalary);
    assert.deepEqual(reloadedBody.budgets, persistedBody.budgets);
    assert.equal(persistedBody.investments[0].fundAllocations?.[0].amount, 25000);
    assert.equal(persistedBody.investments[0].fundAllocations?.[0].investmentDate, "2030-04-02");
    assert.equal(persistedBody.investments[0].fundAllocations?.[1].amount, 60500);
    assert.deepEqual(
      persistedBody.investments[0].fundAllocations?.map((allocation) => allocation.id),
      ["allocation-1", "allocation-grown-annual"],
    );
    assert.equal(
      persistedBody.investments[0].fundAllocations?.[0].sourceId,
      `legacy-annual-once-${unique}`,
    );
    assert.equal(
      persistedBody.investments[0].fundAllocations?.[0].opportunityDate,
      "2030-04-01",
    );
    assert.deepEqual(reloadedBody.investments[0].fundAllocations, persistedBody.investments[0].fundAllocations);
    assert.deepEqual(persistedBody.investments[0].disposals, [{
      id: "sale-1",
      name: "Listed share sale",
      purchaseDate: "2024-01-15",
      saleDate: "2026-08-20",
      costBasis: 100000,
      proceeds: 180000,
      assetType: "Listed Equity",
      eligibleExemption: 10000,
      indexedCostBasis: 120000,
      grandfatheredValue: 150000,
    }]);
    assert.deepEqual(reloadedBody.investments[0].disposals, persistedBody.investments[0].disposals);
    assert.deepEqual(persistedBody.uiPreferences.investmentOrder, []);
    assert.equal(persistedBody.uiPreferences.investmentSort.by, "manual");

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    assert.ok(row);
    const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.userId, userId));
    const [budget] = await db
      .select()
      .from(budgetsTable)
      .where(and(eq(budgetsTable.userId, userId), eq(budgetsTable.category, "Food")));
    const [salary] = await db
      .select()
      .from(salaryDetailsTable)
      .where(eq(salaryDetailsTable.incomeSourceId, `legacy-annual-salary-${unique}`));
    const [profile] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    assert.equal(profile?.riskPreference, "Growth");
    assert.equal(Number(expense?.amount), 2999);
    assert.deepEqual(budget?.details, { schedules: payload.budgets[0].schedules });
    assert.equal(salary?.grossCtcMode, "automatic");
    assert.equal(salary?.tdsMode, "automatic");
    assert.equal(salary?.taxRegime, "new");
    assert.equal(salary?.financialYear, "2025-26");
    assert.equal(salary?.taxRuleVersion, "india-fy2025-26-v1");

    const withPreferences = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        uiPreferences: {
          hack: true,
          investmentOrder: ["inv-1", "missing", "inv-1"],
          archivedPlanningCategories: ["Pet care", "Pet care", "Old typo"],
          investmentSort: { by: "gain", direction: "asc" },
          loanSort: { by: "not-a-field", direction: "desc" },
        },
      }),
    });
    assert.equal(withPreferences.status, 200);
    const preferenceBody = await withPreferences.json() as {
      uiPreferences: {
        investmentOrder: string[];
        investmentSort: { by: string; direction: string };
        loanSort: { by: string };
        archivedPlanningCategories: string[];
        hack?: unknown;
      };
    };
    assert.deepEqual(preferenceBody.uiPreferences.investmentOrder, ["inv-1", "missing"]);
    assert.deepEqual(preferenceBody.uiPreferences.investmentSort, { by: "gain", direction: "asc" });
    assert.equal(preferenceBody.uiPreferences.loanSort.by, "manual");
    assert.deepEqual(preferenceBody.uiPreferences.archivedPlanningCategories, ["Pet care", "Old typo"]);
    assert.equal("hack" in preferenceBody.uiPreferences, false);

    const cleared = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "DELETE",
    });
    assert.equal(cleared.status, 200);
    const clearedBody = await cleared.json() as { expenses: unknown[]; budgets: unknown[] };
    assert.deepEqual(clearedBody.expenses, []);
    assert.deepEqual(clearedBody.budgets, []);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("planning category management never rewrites historical expenses", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `planning-category-${unique}`;
  const expenseId = `historical-expense-${unique}`;
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
  });
  await db.insert(expensesTable).values({
    id: expenseId,
    userId,
    date: "2025-01-15",
    amount: "1800",
    category: "Pet caare",
    merchant: "Veterinary clinic",
    paymentMethod: "Card",
    note: "Historical record",
    createdAt: new Date("2025-01-15T10:00:00.000Z"),
  });
  await db.insert(budgetsTable).values([
    {
      id: `budget-typo-${unique}`,
      userId,
      category: "Pet caare",
      monthlyLimit: "5000",
      details: {},
    },
    {
      id: `budget-unused-${unique}`,
      userId,
      category: "Unused custom",
      monthlyLimit: "0",
      details: {},
    },
    {
      id: `budget-core-${unique}`,
      userId,
      category: "Housing",
      monthlyLimit: "20000",
      details: {},
    },
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = {
      id: userId,
      email: `${userId}@example.test`,
      isAdmin: false,
    } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const [expenseBefore] = await db
      .select()
      .from(expensesTable)
      .where(eq(expensesTable.id, expenseId));

    const renamed = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/${encodeURIComponent("Pet caare")}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", nextCategory: "Pet care" }),
      },
    );
    assert.equal(renamed.status, 200);
    const renamedBody = await renamed.json() as {
      expenses: Array<{ id: string; category: string }>;
      budgets: Array<{ category: string }>;
      uiPreferences: { archivedPlanningCategories: string[] };
    };
    assert.equal(renamedBody.expenses.find((expense) => expense.id === expenseId)?.category, "Pet caare");
    assert.equal(renamedBody.budgets.some((budget) => budget.category === "Pet care"), true);
    assert.deepEqual(renamedBody.uiPreferences.archivedPlanningCategories, ["Pet caare"]);

    const [expenseAfterRename] = await db
      .select()
      .from(expensesTable)
      .where(eq(expensesTable.id, expenseId));
    assert.deepEqual(expenseAfterRename, expenseBefore);

    const archived = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/${encodeURIComponent("Pet care")}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      },
    );
    assert.equal(archived.status, 200);
    const archivedBody = await archived.json() as {
      budgets: Array<{ category: string }>;
      uiPreferences: { archivedPlanningCategories: string[] };
    };
    assert.equal(archivedBody.budgets.some((budget) => budget.category === "Pet care"), true);
    assert.deepEqual(
      archivedBody.uiPreferences.archivedPlanningCategories,
      ["Pet caare", "Pet care"],
    );

    const restored = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/${encodeURIComponent("Pet care")}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      },
    );
    assert.equal(restored.status, 200);
    const restoredBody = await restored.json() as {
      budgets: Array<{ category: string; monthlyLimit: number }>;
      uiPreferences: { archivedPlanningCategories: string[] };
    };
    assert.equal(
      restoredBody.budgets.find((budget) => budget.category === "Pet care")?.monthlyLimit,
      5000,
    );
    assert.deepEqual(restoredBody.uiPreferences.archivedPlanningCategories, ["Pet caare"]);

    const archivedUnused = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/${encodeURIComponent("Unused custom")}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      },
    );
    assert.equal(archivedUnused.status, 200);
    const unusedBody = await archivedUnused.json() as {
      budgets: Array<{ category: string }>;
    };
    assert.equal(unusedBody.budgets.some((budget) => budget.category === "Unused custom"), true);

    const coreAttempt = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/Housing`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      },
    );
    assert.equal(coreAttempt.status, 400);
    const [housingBudget] = await db
      .select()
      .from(budgetsTable)
      .where(and(eq(budgetsTable.userId, userId), eq(budgetsTable.category, "Housing")));
    assert.ok(housingBudget);

    const [expenseAfterArchive] = await db
      .select()
      .from(expensesTable)
      .where(eq(expensesTable.id, expenseId));
    assert.deepEqual(expenseAfterArchive, expenseBefore);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("restoring a legacy archived category recreates an empty usable plan", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `legacy-archived-category-${unique}`;
  const category = "Legacy hobby";
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
  });
  await db.insert(userProfilesTable).values({
    userId,
    uiPreferences: {
      archivedPlanningCategories: [category],
    },
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = {
      id: userId,
      email: `${userId}@example.test`,
      isAdmin: false,
    } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/${encodeURIComponent(category)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      },
    );

    assert.equal(response.status, 200);
    const body = await response.json() as {
      budgets: Array<{
        category: string;
        monthlyLimit: number;
        windows: Array<{ id: string; monthlyLimit: number; endMode: string }>;
      }>;
      uiPreferences: { archivedPlanningCategories: string[] };
    };
    const restoredBudget = body.budgets.find((budget) => budget.category === category);
    assert.equal(restoredBudget?.monthlyLimit, 0);
    assert.deepEqual(restoredBudget?.windows, [{
      id: restoredBudget?.windows[0]?.id,
      monthlyLimit: 0,
      endMode: "lifelong",
    }]);
    assert.deepEqual(body.uiPreferences.archivedPlanningCategories, []);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("financial data routes reject unauthenticated users", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => false) as Request["isAuthenticated"];
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/financial-data`);
    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});
