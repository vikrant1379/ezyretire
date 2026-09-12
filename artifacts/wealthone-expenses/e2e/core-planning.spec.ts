import { expect, test, type Page, type Route } from "@playwright/test";

const user = { id: "core-planning-user", email: "plan@example.com", fullName: "Core Planner", dateOfBirth: "1990-01-15", gender: "Prefer not to say", phone: "", onboardingCompleted: false, isAdmin: false };

const emptyData = () => ({
  expenses: [], budgets: [], incomeSources: [], investments: [], loans: [], plannedExpenses: [],
  retirementInputs: { dateOfBirth: "1990-01-15", targetRetirementAge: 60, lifeExpectancy: 85, generalInflation: 6, salaryGrowth: 7, monthlyContributionOverride: 0, investSurplus: false },
  profileInputs: { fullName: user.fullName, email: user.email, phone: "", gender: user.gender, dateOfBirth: user.dateOfBirth, targetRetirementAge: 60, lifeExpectancy: 85, riskPreference: "Balanced", onboardingCompleted: false },
  uiPreferences: {},
});

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockedApp(page: Page, document: ReturnType<typeof emptyData>) {
  let data: any = structuredClone(document);
  await page.route("**/api/auth/user", route => json(route, { user }));
  await page.route("**/api/financial-data/retirement-plan", async route => {
    if (route.request().method() === "PUT") {
      const retirementInputs = JSON.parse(route.request().postData() ?? "{}");
      data = {
        ...data,
        retirementInputs,
        profileInputs: {
          ...data.profileInputs,
          targetRetirementAge: retirementInputs.targetRetirementAge,
          lifeExpectancy: retirementInputs.lifeExpectancy,
        },
      };
    }
    await json(route, data);
  });
  await page.route("**/api/financial-data", async route => {
    if (route.request().method() === "PUT") data = JSON.parse(route.request().postData() ?? "{}");
    await json(route, data);
  });
  return () => data;
}

test("mobile quick start can exit, resume, skip, go back, complete, and rerun @touch", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const saved = await mockedApp(page, emptyData());
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Build your first estimate" })).toBeVisible();
  await expect(page.getByText("Optional quick start · Step 1 of 8")).toBeVisible();
  await expect(page.getByText("About you")).toBeVisible();
  await page.getByRole("button", { name: "Finish later" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(saved().profileInputs.onboardingProgress).toMatchObject({ currentStep: 1, dismissed: true });
  await page.goto("/onboarding");
  await expect(page.getByText("About you")).toBeVisible();
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByText(/one starter income/i).first()).toBeVisible();
  await expect(page.getByText(/every other income later from Income/i)).toBeVisible();
  await page.locator("input").nth(0).fill("Discard this income");
  await page.locator("input").nth(1).fill("12345");
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText("Everyday expenses")).toBeVisible();
  expect(saved().incomeSources).toHaveLength(0);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("page-content").getByText("Income", { exact: true })).toBeVisible();
  expect(saved().profileInputs.onboardingProgress.skippedSteps).toContain(2);
  await page.locator("input").nth(0).fill("Salary");
  await page.locator("input").nth(1).fill("75000");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.locator("input").nth(0).fill("Living");
  await page.locator("input").nth(1).fill("25000");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "yearly", exact: true }).click();
  await page.locator('input[type="date"]').fill("2026-01-01");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.locator("input").nth(0).fill("Index fund");
  await page.locator("input").nth(1).fill("100000");
  await page.getByRole("button", { name: "Finish later" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(saved().investments).toHaveLength(0);
  expect(saved().profileInputs.onboardingProgress.currentStep).toBe(4);
  await page.goto("/onboarding");
  await expect(page.getByTestId("page-content").getByText("Investments", { exact: true })).toBeVisible();
  await page.locator("input").nth(0).fill("Index fund");
  await page.locator("input").nth(1).fill("100000");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.locator("input").nth(0).fill("Home loan");
  await page.locator("input").nth(1).fill("500000");
  await page.locator("input").nth(2).fill("101");
  await page.locator("input").nth(3).fill("0");
  await page.getByRole("button", { name: "Skip for now" }).click();
  expect(saved().loans).toHaveLength(0);
  await page.locator("input").nth(0).fill("Home upgrade");
  await page.locator("input").nth(1).fill("300000");
  await page.locator('input[type="date"]').fill("2030-01-01");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByText("Your first estimate is ready.")).toBeVisible();
  await expect(page.getByText(/not your complete financial inventory/i)).toBeVisible();
  await expect(page.getByText("Required corpus")).toBeVisible();
  await page.getByRole("button", { name: "Save first estimate" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(saved().incomeSources).toHaveLength(1);
  expect(saved().plannedExpenses).toHaveLength(1);
  expect(saved().profileInputs.onboardingCompleted).toBe(true);

  await page.goto("/onboarding");
  await expect(page.getByText("About you")).toBeVisible();
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByText(/one starter income/i).first()).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText("Everyday expenses")).toBeVisible();
  await page.getByRole("button", { name: "Finish later" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(saved().profileInputs.onboardingCompleted).toBe(true);
  expect(saved().profileInputs.onboardingProgress).toMatchObject({ currentStep: 3, rerunInProgress: true });
  await page.goto("/onboarding");
  await expect(page.getByText("Everyday expenses")).toBeVisible();
});

test("desktop finish later ignores the current draft and keeps dashboard access", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const data: any = emptyData();
  data.profileInputs.onboardingProgress = {
    currentStep: 5,
    completedSteps: [1, 2, 3, 4],
    skippedSteps: [],
    firstProjectionSaved: false,
  };
  data.investments = [{ id: "saved-investment", name: "Existing fund", assetClass: "Mutual Funds", investedAmount: 1000, currentValue: 1000, monthlyContribution: 0, expectedReturn: 12, createdAt: "2026-01-01T00:00:00.000Z" }];
  const saved = await mockedApp(page, data);
  await page.goto("/onboarding");
  await expect(page.getByText(/one starter loan/i).first()).toBeVisible();
  await expect(page.getByText(/every other debt later from Loans/i)).toBeVisible();
  await page.locator("input").nth(0).fill("Unfinished loan");
  await page.locator("input").nth(1).fill("500000");
  await page.getByRole("button", { name: "Finish later" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Keep building your plan")).toBeVisible();
  expect(saved().loans).toHaveLength(0);
  expect(saved().investments).toHaveLength(1);
  expect(saved().profileInputs.onboardingProgress).toMatchObject({ currentStep: 5, dismissed: true });
  await page.reload();
  await expect(page.getByText("Keep building your plan")).toBeVisible();
  await page.getByRole("link", { name: "Open quick start" }).click();
  await expect(page.getByTestId("page-content").getByText("Loans", { exact: true })).toBeVisible();
});

test("desktop completed account exposes planned, cadence, and loan planning surfaces without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const data: any = emptyData();
  data.profileInputs.onboardingCompleted = true;
  data.budgets = [{ category: "Travel", monthlyLimit: 0, windows: [{ id: "annual-trip", monthlyLimit: 120000, cadence: "yearly", annualMonth: 11, startDate: "2026-01-01", endMode: "lifelong" }] }];
  data.plannedExpenses = [{ id: "home", name: "Home purchase", category: "Home", amount: 2_000_000, expectedDate: "2031-01-01", createdAt: "2026-01-01T00:00:00.000Z" }];
  data.loans = [
    { id: "emi", type: "Other", name: "Car loan", sanctionedPrincipal: 200000, outstandingPrincipal: 200000, annualInterestRate: 11, interestType: "Fixed", totalTenureMonths: 48, startDate: "2026-01-01", emi: 5169, repaymentType: "emi", prepayments: 0, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "bullet", type: "Other", name: "Bridge loan", sanctionedPrincipal: 500000, outstandingPrincipal: 500000, annualInterestRate: 10, interestType: "Fixed", totalTenureMonths: 24, startDate: "2027-01-01", emi: 0, repaymentType: "bullet", prepayments: 0, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "io", type: "Other", name: "Construction", sanctionedPrincipal: 300000, outstandingPrincipal: 300000, annualInterestRate: 9, interestType: "Fixed", totalTenureMonths: 36, startDate: "2026-01-01", emi: 2250, repaymentType: "interest-only-plus-bullet", prepayments: 0, createdAt: "2026-01-01T00:00:00.000Z" },
  ];
  await mockedApp(page, data);
  await page.goto("/budgets");
  await expect(page.getByText("Planned future expenses")).toBeVisible();
  await expect(page.getByText("Home purchase")).toBeVisible();
  await expect(page.getByText(/Yearly:/).first()).toBeVisible();
  await page.goto("/loans");
  await expect(page.getByText("All-loans debt-free overview")).toBeVisible();
  await expect(page.getByText("Debt payoff timeline")).toBeVisible();
  await expect(page.getByText("Bullet maturity obligation")).toBeVisible();
  await page.getByRole("button", { name: /show amortization for Bridge loan/i }).click();
  await expect(page.getByText("Prepayment Simulator")).toBeVisible();
  await page.goto("/retirement");
  await expect(page.getByText(/retirement/i).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("mobile retirement is chart-first, previews every lifestyle, and reloads the detailed plan @touch", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const data: any = emptyData();
  data.profileInputs.onboardingCompleted = true;
  data.incomeSources = [{
    id: "salary",
    name: "Salary",
    type: "Salary",
    frequency: "Monthly",
    amount: 100_000,
    date: "2026-01-01",
    recurring: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  }];
  data.budgets = [{ category: "Living", monthlyLimit: 30_000 }];
  data.investments = [{
    id: "fund",
    name: "Index fund",
    assetClass: "Mutual Funds",
    investedAmount: 500_000,
    currentValue: 550_000,
    monthlyContribution: 10_000,
    expectedReturn: 10,
    createdAt: "2026-01-01T00:00:00.000Z",
  }];
  const saved = await mockedApp(page, data);

  await page.goto("/retirement");
  const results = page.getByTestId("retirement-main-results");
  const chart = page.getByTestId("retirement-projection-chart");
  const milestones = page.getByTestId("retirement-milestone-summary");
  const lifestyle = page.getByTestId("retirement-lifestyle");
  const planner = page.getByTestId("retirement-detailed-planner");
  await expect(results).toBeVisible();
  await expect(chart).toBeVisible();
  await expect(milestones).toBeAttached();
  const milestoneBounds = await milestones.boundingBox();
  expect(milestoneBounds?.width).toBeLessThanOrEqual(1);
  expect(milestoneBounds?.height).toBeLessThanOrEqual(1);
  await expect(chart).toHaveAttribute("aria-describedby", "retirement-milestone-summary");
  await expect(page.getByRole("heading", { name: "Choose your retirement lifestyle" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open detailed planner" })).toBeVisible();
  await expect(chart.getByTestId("retirement-chart-legend")).toContainText("Base corpus");
  await expect(chart.locator(".recharts-area-area")).toHaveCount(1);
  await expect(chart.locator(".recharts-line-curve")).toHaveCount(3);
  await expect(chart.locator(".recharts-area-area")).toHaveAttribute("d", /\S+/);
  await expect(chart.locator(".recharts-line-curve").last()).toHaveAttribute("d", /\S+/);

  const positions = await Promise.all([results, chart, lifestyle, planner].map(async locator =>
    (await locator.boundingBox())?.y ?? Number.POSITIVE_INFINITY));
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[1]).toBeLessThan(positions[2]);
  expect(positions[2]).toBeLessThan(positions[3]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const required = page.getByTestId("result-required-corpus");
  const projected = page.getByTestId("result-projected-corpus");
  const expense = page.getByTestId("result-retirement-expense");
  await expect(milestones).toContainText((await projected.textContent()) ?? "");
  await expect(milestones).toContainText((await required.textContent()) ?? "");
  await expect(milestones).toContainText(/Projected corpus depletion/);
  let priorRequired = await required.textContent();
  let priorChartLabel = await chart.getAttribute("aria-label");
  let priorNeededPath = await chart.locator(".recharts-line-curve").last().getAttribute("d");
  for (const choice of ["basic", "comfortable", "premium"]) {
    await page.getByTestId(`button-lifestyle-${choice}`).click();
    await expect.poll(() => required.textContent()).not.toBe(priorRequired);
    await expect.poll(() => chart.getAttribute("aria-label")).not.toBe(priorChartLabel);
    await expect.poll(() => chart.locator(".recharts-line-curve").last().getAttribute("d")).not.toBe(priorNeededPath);
    priorRequired = await required.textContent();
    priorChartLabel = await chart.getAttribute("aria-label");
    priorNeededPath = await chart.locator(".recharts-line-curve").last().getAttribute("d");
  }
  await page.getByTestId("button-lifestyle-custom").click();
  await page.getByTestId("input-custom-lifestyle-expense").fill("52000");
  await expect.poll(() => expense.textContent()).not.toContain("₹0");
  await expect.poll(() => chart.getAttribute("aria-label")).not.toBe(priorChartLabel);
  await expect.poll(() => chart.locator(".recharts-line-curve").last().getAttribute("d")).not.toBe(priorNeededPath);
  await page.getByTestId("button-lifestyle-premium").click();
  await chart.getByRole("tab", { name: "LIFESTYLE" }).click();
  await expect(chart.getByRole("tab", { name: "LIFESTYLE" })).toHaveAttribute("aria-selected", "true");
  await expect(chart.getByTestId("retirement-chart-legend")).toContainText("Pension income");
  await expect(chart.locator(".recharts-line-curve")).toHaveCount(3);
  await chart.getByRole("tab", { name: "CORPUS" }).click();

  await page.getByRole("button", { name: "Open detailed planner" }).click();
  await expect(page.getByText("Retirement What-If", { exact: true })).toBeVisible();
  await expect(page.getByText("Purchasing Power", { exact: true })).toBeVisible();
  await expect(page.getByText("SIP Step-Up", { exact: true })).toBeVisible();
  await expect(page.getByTestId("retirement-action-guidance")).toContainText("Extra SIP needed from today");
  await page.getByTestId("button-add-pension").click();
  await expect(results.getByText("Pensions scheduled")).toHaveCount(0);
  await expect(page.getByText("No pension income currently affects this forecast.")).toBeVisible();
  const pensionRow = page.locator("[data-testid^='row-pension-']").last();
  await pensionRow.locator("[data-testid^='input-pension-name-']").fill("Employer pension");
  await pensionRow.locator("[data-testid^='input-pension-amount-']").fill("12000");
  await pensionRow.locator("[data-testid^='input-pension-age-']").fill("50");
  await pensionRow.locator("[data-testid^='input-pension-escalation-']").fill("3");
  await expect(pensionRow.getByText("Takes effect at retirement age 60.")).toBeVisible();
  await page.getByTestId("button-add-pension").click();
  const secondPensionRow = page.locator("[data-testid^='row-pension-']").last();
  await secondPensionRow.locator("[data-testid^='input-pension-name-']").fill("Government pension");
  await secondPensionRow.locator("[data-testid^='input-pension-amount-']").fill("8000");
  await secondPensionRow.locator("[data-testid^='input-pension-age-']").fill("70");
  await expect(results.getByText("Pensions scheduled")).toBeVisible();
  await expect(results.getByText("2 sources · ages 60, 70")).toBeVisible();
  await expect(milestones).toContainText("Effective pension start ages");
  await expect(milestones).toContainText("60, 70");

  const previewRequired = await required.textContent();
  const previewExpense = await expense.textContent();
  await page.getByRole("button", { name: "Save Projection Plan" }).click();
  await expect(page.getByRole("button", { name: "Plan Saved" })).toBeDisabled();
  expect(saved().retirementInputs).toMatchObject({
    lifestyleChoice: "Premium",
    pensionSources: [{
      name: "Employer pension",
      monthlyAmount: 12_000,
      startAge: 50,
      annualEscalationRate: 3,
    }, {
      name: "Government pension",
      monthlyAmount: 8_000,
      startAge: 70,
    }],
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Your retirement lifestyle" })).toBeVisible();
  await expect(page.getByText(/Premium ·/)).toBeVisible();
  await expect(page.getByTestId("result-required-corpus")).toHaveText(previewRequired ?? "");
  await expect(page.getByTestId("result-retirement-expense")).toHaveText(previewExpense ?? "");
  await expect(page.getByText("2 pension sources are modeled separately from the later of its configured start age or retirement.")).toBeVisible();
  await expect(page.getByTestId("retirement-main-results").getByText("2 sources · ages 60, 70")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});