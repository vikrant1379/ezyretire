import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import webpush from "web-push";
import { generateFinancialCalendar } from "../../../wealthone-expenses/src/lib/financial-calendar.js";
import type { IncomeSource } from "../../../wealthone-expenses/src/lib/storage.js";
import { getEnv } from "./env.js";
import {
  loadFinancialData,
  loadMonthlyReportEmailDeliveriesForUser,
  loadPushSubscriptionsForUser,
  updatePlanningFeatures,
} from "./finance-store.js";
import {
  MonthlyReportAttachmentTooLargeError,
  sendMonthlyReportEmail,
} from "./monthly-report-email.js";
import {
  accountDeletionRequestsTable,
  db,
  planningSchedulerStateTable,
  usersTable,
  type StoredMonthlyReportSnapshot,
} from "@workspace/db";
import { calculateRetirementProjection, calculateRetirementReadiness } from "../../../wealthone-expenses/src/lib/retirement-projection.js";
import { accountHash, withAccountWriteFence } from "./account-compliance.js";

const sectionIds = ["income-vs-expected", "expenses-vs-budget-category", "savings-amount-rate", "portfolio-value-returns-change", "net-worth-change", "retirement-date-movement", "health-score-change", "top-next-month-actions"] as const;

const RETIREMENT_FORECAST_MODEL_VERSION = 1;
export const PLANNING_INVOCATION_LIMIT = 10;
export const PLANNING_INVOCATION_BUDGET_MS = 20_000;
export const PLANNING_ADMISSION_RESERVE_MS = 8_000;
type NotificationType = "budget" | "retirement" | "goal" | "upcoming" | "milestone" | "tax" | "anomaly";
type Preferences = {
  enabled: boolean;
  push: boolean;
  monthlyReportEmail: boolean;
  types: Record<NotificationType, boolean>;
  quietHours: { start: string; end: string };
  timeZone: string;
};
type Notice = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  deliverAfter: string;
  channels: Array<"in-app" | "push">;
  dismissedAt?: string;
  pushDeliveredAt?: string;
};

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}
function dateKey(parts: ReturnType<typeof localParts>) { return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`; }
function localInstant(parts: ReturnType<typeof localParts>, timeZone: string) {
  let result = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  // Offset is derived at the requested instant, so this also handles DST. A
  // nonexistent wall time settles on the first valid instant after the gap.
  for (let i = 0; i < 4; i += 1) {
    const actual = localParts(result, timeZone);
    const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const observed = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const delta = wanted - observed;
    if (!delta) break;
    result = new Date(result.getTime() + delta);
  }
  return result;
}
export function quietUntil(now: Date, preferences: Preferences) {
  const local = localParts(now, preferences.timeZone);
  const [sh, sm] = preferences.quietHours.start.split(":").map(Number);
  const [eh, em] = preferences.quietHours.end.split(":").map(Number);
  const minute = local.hour * 60 + local.minute, start = sh * 60 + sm, end = eh * 60 + em;
  const quiet = start !== end && (start < end ? minute >= start && minute < end : minute >= start || minute < end);
  if (!quiet) return now;
  const target = { ...local, hour: eh, minute: em };
  if (start >= end && minute >= start) {
    const tomorrow = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
    target.year = tomorrow.getUTCFullYear(); target.month = tomorrow.getUTCMonth() + 1; target.day = tomorrow.getUTCDate();
  }
  return localInstant(target, preferences.timeZone);
}
function previousMonth(now: Date, timeZone: string) {
  const local = localParts(now, timeZone);
  const date = new Date(Date.UTC(local.year, local.month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthIndex(month: string) {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function retirementDateForData(data: Awaited<ReturnType<typeof loadFinancialData>>) {
  const dateOfBirth = String(data.profileInputs?.dateOfBirth ?? "");
  const targetAge = Number(
    data.retirementInputs?.targetRetirementAge ?? data.profileInputs?.targetRetirementAge,
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || !Number.isFinite(targetAge) || targetAge < 0) {
    return undefined;
  }
  return `${Number(dateOfBirth.slice(0, 4)) + Math.trunc(targetAge)}-${dateOfBirth.slice(5, 7)}-01`;
}

function recursOn(anchor: string | undefined, target: string, cadence: "monthly" | "yearly") {
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor) || target < anchor) return false;
  const [year, month, day] = target.split("-").map(Number);
  const [anchorYear, anchorMonth, anchorDay] = anchor.split("-").map(Number);
  if (cadence === "yearly" && month !== anchorMonth) return false;
  const expectedDay = Math.min(anchorDay, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return year >= anchorYear && day === expectedDay;
}

function budgetWindowAmountForMonth(window: Record<string, unknown>, month: string, retirementDate?: string) {
  const start = String(window.startDate ?? window.startMonth ?? "1900-01").slice(0, 7);
  const end = window.endMode === "retirement"
    ? retirementDate?.slice(0, 7)
    : window.endDate || window.endMonth
      ? String(window.endDate ?? window.endMonth).slice(0, 7)
      : undefined;
  if (month < start || (end && month > end)) return 0;
  const elapsed = monthIndex(month) - monthIndex(start);
  const cadence = String(window.cadence ?? "monthly");
  const occurs = cadence === "monthly"
    || (cadence === "quarterly" && elapsed >= 0 && elapsed % 3 === 0)
    || (cadence === "half-yearly" && elapsed >= 0 && elapsed % 6 === 0)
    || (cadence === "one-time" && elapsed === 0)
    || (cadence === "yearly" && Number(window.annualMonth) === Number(month.slice(5, 7)) - 1);
  return occurs ? Number(window.monthlyLimit ?? window.amount ?? 0) : 0;
}

function budgetAmountForMonth(item: unknown, month: string, retirementDate?: string) {
  const plan = item as { monthlyLimit?: number; windows?: Array<Record<string, unknown>> };
  return plan.windows?.length
    ? plan.windows.reduce((sum, window) => sum + budgetWindowAmountForMonth(window, month, retirementDate), 0)
    : Number(plan.monthlyLimit ?? 0);
}

function expectedIncomeForMonth(
  incomes: Awaited<ReturnType<typeof loadFinancialData>>["incomeSources"],
  month: string,
  retirementDate?: string,
) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return generateFinancialCalendar({
    from: `${month}-01`,
    through: `${month}-${String(lastDay).padStart(2, "0")}`,
    incomes: incomes as IncomeSource[],
    ...(retirementDate ? { retirementDate } : {}),
  })
    .filter((event) => event.kind === "income")
    .reduce((sum, event) => sum + (event.amount ?? 0), 0);
}

type ScheduledLoan = {
  id: string;
  name: string;
  startDate?: string;
  totalTenureMonths?: number;
  repaymentType?: string;
  sanctionedPrincipal?: number;
  outstandingPrincipal?: number;
  annualInterestRate?: number;
  emi?: number;
};

function scheduledLoanPayoff(item: ScheduledLoan, asOfDate: string) {
  const asOf = new Date(`${asOfDate}T00:00:00Z`);
  const start = item.startDate ? new Date(`${item.startDate}T00:00:00Z`) : undefined;
  const future = Boolean(start && start > asOf);
  const outstanding = Math.max(0, Number(item.outstandingPrincipal ?? 0));
  const principal = future
    ? outstanding || Math.max(0, Number(item.sanctionedPrincipal ?? 0))
    : outstanding;
  const emi = Math.max(0, Number(item.emi ?? 0));
  const repaymentType = item.repaymentType ?? "emi";
  if (principal <= 0 || (repaymentType === "emi" && emi <= 0)) return { principal, remainingMonths: 0 };
  const rate = Math.max(0, Number(item.annualInterestRate ?? 0)) / 1200;
  if (repaymentType !== "emi") {
    const elapsed = start ? Math.max(0, Math.floor((asOf.getTime() - start.getTime()) / (30.4375 * 86_400_000))) : 0;
    return {
      principal,
      remainingMonths: Math.max(1, Math.min(1200, Math.ceil(Math.max(1, Number(item.totalTenureMonths ?? 1)) - elapsed))),
    };
  }
  if (rate === 0) return { principal, remainingMonths: Math.max(1, Math.min(1200, Math.ceil(principal / emi))) };
  if (emi > principal * rate) {
    const calculated = Math.ceil(-Math.log(1 - principal * rate / emi) / Math.log(1 + rate));
    if (Number.isFinite(calculated) && calculated > 0) {
      return { principal, remainingMonths: Math.min(1200, calculated) };
    }
  }
  const elapsed = start ? Math.max(0, Math.floor((asOf.getTime() - start.getTime()) / (30.4375 * 86_400_000))) : 0;
  return {
    principal,
    remainingMonths: Math.max(1, Math.min(1200, Math.ceil(Math.max(1, Number(item.totalTenureMonths ?? 1)) - elapsed))),
  };
}

function nextScheduledLoanDate(startDate: string | undefined, asOfDate: string) {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return undefined;
  if (startDate >= asOfDate) return startDate;
  const [year, month] = asOfDate.split("-").map(Number);
  const day = Number(startDate.slice(8, 10));
  const candidate = `${asOfDate.slice(0, 8)}${String(Math.min(day, new Date(Date.UTC(year, month, 0)).getUTCDate())).padStart(2, "0")}`;
  if (candidate >= asOfDate) return candidate;
  const next = new Date(Date.UTC(year, month, 1));
  const nextDay = Math.min(day, new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate());
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
}

function scheduledEvents(data: Awaited<ReturnType<typeof loadFinancialData>>, from: string, through: string) {
  const events: Array<{ id: string; title: string; date: string }> = [];
  const retirementDate = retirementDateForData(data);
  const add = (id: string, title: string, date: string) => events.push({ id, title, date });
  for (let target = from; target <= through; target = addDays(target, 1)) {
    for (const raw of data.incomeSources) {
      const item = raw as { id: string; name: string; date?: string; recurring?: boolean; frequency?: string; incomeEndMode?: string; incomeEndDate?: string };
      const recurring = item.recurring !== false && item.frequency !== "One-time";
      const occurs = recurring
        ? recursOn(item.date, target, item.frequency === "Annual" ? "yearly" : "monthly")
        : item.date === target;
      const incomeEnd = item.incomeEndMode === "custom"
        ? item.incomeEndDate
        : item.incomeEndMode === "retirement"
          ? retirementDate
          : undefined;
      if (occurs && !(incomeEnd && target > incomeEnd)) {
        add(`income:${item.id}:${target}`, item.name, target);
      }
    }
    for (const raw of data.investments) {
      const item = raw as { id: string; name: string; monthlyContribution?: number; contributionStartDate?: string; contributionEndMode?: string; contributionEndDate?: string; maturityDate?: string };
      const contributionEnd = item.contributionEndMode === "custom"
        ? item.contributionEndDate
        : item.contributionEndMode === "retirement"
          ? retirementDate
          : undefined;
      if (Number(item.monthlyContribution ?? 0) > 0
        && recursOn(item.contributionStartDate ?? from, target, "monthly")
        && !(contributionEnd && target > contributionEnd)) {
        add(`investment:${item.id}:${target}`, `${item.name} contribution`, target);
      }
      if (item.maturityDate === target) add(`investment-maturity:${item.id}:${target}`, `${item.name} matures`, target);
    }
    for (const raw of data.loans) {
      const item = raw as ScheduledLoan;
      const payoff = scheduledLoanPayoff(item, from);
      const firstPayment = nextScheduledLoanDate(item.startDate, from);
      if (!firstPayment || payoff.remainingMonths <= 0) continue;
      const repaymentType = item.repaymentType ?? "emi";
      const originalMaturityMonth = item.startDate
        ? monthIndex(item.startDate.slice(0, 7)) + Math.max(1, Number(item.totalTenureMonths ?? 1)) - 1
        : -1;
      const firstMonth = monthIndex(firstPayment.slice(0, 7));
      const targetMonth = monthIndex(target.slice(0, 7));
      const contractMaturityFuture = originalMaturityMonth >= monthIndex(from.slice(0, 7));
      const occurs = recursOn(firstPayment, target, "monthly");
      const due = repaymentType === "emi"
        ? occurs && targetMonth - firstMonth < payoff.remainingMonths
        : repaymentType === "bullet"
          ? occurs && targetMonth === (contractMaturityFuture ? originalMaturityMonth : firstMonth)
          : occurs && targetMonth <= (contractMaturityFuture ? originalMaturityMonth : firstMonth);
      if (due) {
        add(`loan:${item.id}:${target}`, `${item.name} payment`, target);
      }
    }
    for (const raw of data.budgets) {
      const item = raw as { category: string; windows?: Array<Record<string, unknown>> };
      for (const window of item.windows ?? []) {
        const cadence = String(window.cadence ?? "monthly");
        const anchor = String(window.startDate ?? from);
        const elapsed = monthIndex(target.slice(0, 7)) - monthIndex(anchor.slice(0, 7));
        const cadenceMatches = cadence === "monthly"
          || (cadence === "quarterly" && elapsed >= 0 && elapsed % 3 === 0)
          || (cadence === "half-yearly" && elapsed >= 0 && elapsed % 6 === 0)
          || (cadence === "one-time" && elapsed === 0)
          || cadence === "yearly";
        const occurrence = cadenceMatches && recursOn(
          cadence === "yearly" && Number.isInteger(window.annualMonth)
            ? `${target.slice(0, 4)}-${String(Number(window.annualMonth) + 1).padStart(2, "0")}-01`
            : anchor,
          target,
          cadence === "yearly" ? "yearly" : "monthly",
        );
        const end = window.endDate ? String(window.endDate) : undefined;
        const scheduleEnd = window.endMode === "retirement" ? retirementDate : end;
        const scheduleStart = window.startDate ? String(window.startDate) : undefined;
        if (occurrence && !(scheduleStart && target < scheduleStart)
          && !(scheduleEnd && target > scheduleEnd)) {
          add(`budget:${String(window.id)}:${target}`, `${item.category} budget`, target);
        }
      }
    }
    for (const raw of data.plannedExpenses) {
      const item = raw as { id: string; name: string; expectedDate?: string };
      if (item.expectedDate === target) add(`planned:${item.id}:${target}`, item.name, target);
    }
    for (const raw of data.reminders ?? []) {
      const item = raw as { id: string; title: string; date?: string; recurrence?: string; enabled?: boolean };
      if (!item.enabled) continue;
      const occurs = item.recurrence === "monthly"
        ? recursOn(item.date, target, "monthly")
        : item.recurrence === "yearly"
          ? recursOn(item.date, target, "yearly")
          : item.date === target;
      if (occurs) add(`reminder:${item.id}:${target}`, item.title, target);
    }
  }
  return events;
}
function vapidConfigured() {
  return Boolean(getEnv("VAPID_PUBLIC_KEY") && getEnv("VAPID_PRIVATE_KEY") && getEnv("VAPID_SUBJECT"));
}
export function getWebPushConfiguration() {
  const publicKey = getEnv("VAPID_PUBLIC_KEY");
  return vapidConfigured() && publicKey
    ? { supported: true as const, publicKey }
    : { supported: false as const };
}
async function deliverPush(user: typeof usersTable.$inferSelect, notices: Notice[], subscriptions: Array<{ endpoint: string; p256dh?: string; auth?: string }>) {
  if (!vapidConfigured()) return;
  webpush.setVapidDetails(getEnv("VAPID_SUBJECT")!, getEnv("VAPID_PUBLIC_KEY")!, getEnv("VAPID_PRIVATE_KEY")!);
  for (const notice of notices.filter((item) => item.channels.includes("push") && !item.pushDeliveredAt)) {
    let delivered = false;
    for (const subscription of subscriptions) {
      if (!subscription.p256dh || !subscription.auth) continue;
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify({
            title: "ezyRetire notification",
            body: "You have a new financial alert. Sign in to review it.",
            tag: notice.id,
            ownerUserId: user.id,
          }),
        );
        delivered = true;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) await updatePlanningFeatures(user, { removePushEndpoint: subscription.endpoint });
      }
    }
    if (delivered) await updatePlanningFeatures(user, { pushDeliveredNotificationId: notice.id });
  }
}
async function sendDigest(email: string, count: number, key: string) {
  const apiKey = getEnv("RESEND_API_KEY"), from = getEnv("AUTH_EMAIL_FROM");
  if (!apiKey || !from || count === 0) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": key },
    // Keep financial details out of email: this is deliberately only a coarse
    // count and a sign-in action.
    body: JSON.stringify({ from, to: [email], subject: "Your ezyRetire weekly planning digest", text: `You have ${count} planning alerts. Sign in to review suggested actions.` }),
    signal: AbortSignal.timeout(8_000),
  });
}
export function reportFor(
  data: Awaited<ReturnType<typeof loadFinancialData>>,
  month: string,
  options: {
    generatedAt?: Date;
    captureLivePortfolio?: boolean;
    captureLiveRetirementTarget?: boolean;
    captureLiveRetirementForecast?: boolean;
  } = {},
) {
  const monthExpenses = data.expenses.filter((item) => String((item as { date?: string }).date).slice(0, 7) === month);
  const expenses = monthExpenses.reduce<number>((sum, item) => sum + Number((item as { amount?: number }).amount ?? 0), 0);
  const retirementDate = retirementDateForData(data);
  const expectedIncome = expectedIncomeForMonth(data.incomeSources, month, retirementDate);
  const receivedIncome = (data.incomeReceipts ?? [])
    .filter((item) => String((item as { receivedDate?: string }).receivedDate).slice(0, 7) === month)
    .reduce<number>((sum, item) => sum + Number((item as { amount?: number }).amount ?? 0), 0);
  const budget = data.budgets.reduce<number>(
    (sum, item) => sum + budgetAmountForMonth(item, month, retirementDate), 0,
  );
  const categoryBudgets = data.budgets.reduce<Record<string, number>>((totals, item) => {
    const plan = item as { category?: string };
    const category = plan.category || "Uncategorized";
    totals[category] = (totals[category] ?? 0) + budgetAmountForMonth(item, month, retirementDate);
    return totals;
  }, {});
  const portfolio = data.investments.reduce<number>((sum, item) => sum + Number((item as { currentValue?: number }).currentValue ?? 0), 0);
  const invested = data.investments.reduce<number>((sum, item) => sum + Number((item as { investedAmount?: number }).investedAmount ?? 0), 0);
  const snapshot = data.netWorthSnapshots.find((item) => (item as { month?: string }).month === month) as { netWorth?: number; healthScore?: number } | undefined;
  const previousDate = new Date(`${month}-01T00:00:00Z`);
  previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previousMonth = previousDate.toISOString().slice(0, 7);
  const previousSnapshot = data.netWorthSnapshots.find((item) => (item as { month?: string }).month === previousMonth) as { netWorth?: number; healthScore?: number } | undefined;
  const previousReport = (data.monthlyReports ?? []).find((item) => item.month === previousMonth);
  const previousMetric = (sectionId: string, key: string): number | undefined => {
    const section = previousReport?.sections.find((item) => item.id === sectionId) as
      | { metrics?: Record<string, unknown> }
      | undefined;
    const value = section?.metrics?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const measuredSnapshotValue = (
    value: unknown,
  ): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const categoryTotals = monthExpenses.reduce<Record<string, number>>((totals, item) => {
    const expense = item as { category?: string; amount?: number };
    const category = expense.category || "Uncategorized";
    totals[category] = (totals[category] ?? 0) + Number(expense.amount ?? 0);
    return totals;
  }, {});
  const [topCategory = "No expense category", topCategorySpend = 0] =
    Object.entries(categoryTotals).sort(([, left], [, right]) => right - left)[0] ?? [];
  const savings = receivedIncome - expenses;
  const netWorth = measuredSnapshotValue(snapshot?.netWorth);
  const previousNetWorth = measuredSnapshotValue(previousSnapshot?.netWorth);
  const healthScore = measuredSnapshotValue(snapshot?.healthScore);
  const previousHealthScore = measuredSnapshotValue(previousSnapshot?.healthScore);
  const portfolioMeasured = options.captureLivePortfolio === true;
  const previousPortfolio = previousMetric("portfolio-value-returns-change", "value");
  const previousInvested = previousMetric("portfolio-value-returns-change", "invested");
  const currentReturn = portfolioMeasured ? portfolio - invested : undefined;
  const previousReturn = previousPortfolio !== undefined && previousInvested !== undefined
    ? previousPortfolio - previousInvested
    : undefined;
  const portfolioReturnChange = currentReturn !== undefined && previousReturn !== undefined
    ? currentReturn - previousReturn
    : undefined;
  const portfolioReturnPercent = portfolioMeasured && invested > 0
    ? currentReturn! / invested * 100
    : undefined;
  const categoryVariances = Object.entries(categoryTotals).map(([category, spent]) =>
    spent - (categoryBudgets[category] ?? 0));
  const retirementTargetMeasured = options.captureLiveRetirementTarget === true;
  const rawTargetAge = data.profileInputs.targetRetirementAge ?? data.retirementInputs.targetRetirementAge;
  const targetAgeMonths = retirementTargetMeasured && Number.isFinite(Number(rawTargetAge))
    ? Number(rawTargetAge) * 12
    : undefined;
  const priorTargetAgeMonths = previousMetric("retirement-date-movement", "targetAgeMonths");
  const forecastMeasured = options.captureLiveRetirementForecast === true;
  const asOfDate = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  const projectionInputs: ForecastInputs | undefined = forecastMeasured ? {
    expenses: data.expenses.map(record),
    budgets: data.budgets.map(record),
    incomes: data.incomeSources.map(record),
    investments: data.investments.map(record),
    loans: data.loans.map(record),
    plannedExpenses: data.plannedExpenses.map(record),
    emergencyFund: record(data.emergencyFund),
    assumptions: {
      ...data.retirementInputs,
      dateOfBirth: data.profileInputs.dateOfBirth ?? "",
    },
  } : undefined;
  const forecast = projectionInputs ? runRetirementForecast(projectionInputs, asOfDate) : undefined;
  const projection = forecast?.projection;
  const projectedRetirementAge = forecast?.projectedRetirementAge ?? null;
  const projectedRetirementMonth = forecast?.projectedRetirementMonth ?? null;
  const priorForecast = previousReport?.retirementForecast;
  const assumptions = projection ? {
    targetRetirementAge: projection.targetAge,
    lifeExpectancy: projection.lifeExpectancy,
    generalInflation: Number(data.retirementInputs.generalInflation ?? 0),
    salaryGrowth: Number(data.retirementInputs.salaryGrowth ?? 0),
    monthlyContribution: projection.modeledMonthlyContribution,
    monthlySpending: projection.cashFlowCostBaseline,
    portfolioValue: projection.currentCorpus,
    investedPrincipal: invested,
    portfolioReturnAmount: projection.currentCorpus - invested,
    expectedReturn: projection.averageExpectedReturn,
  } : undefined;
  const priorInputs = priorForecast?.projectionInputs as ForecastInputs | undefined;
  const driverCandidates: Array<{ magnitude: number; text: string }> = [];
  if (projectionInputs && assumptions && priorForecast && priorInputs) {
    const priorAssumptions = record(priorInputs.assumptions);
    const contributionInputs = {
      ...projectionInputs,
      incomes: priorInputs.incomes,
      investments: neutralizeContributionChanges(
        projectionInputs.investments,
        priorInputs.investments,
      ),
      assumptions: {
        ...projectionInputs.assumptions,
        monthlyContributionOverride: priorAssumptions.monthlyContributionOverride,
        investSurplus: priorAssumptions.investSurplus,
      },
    };
    const priorById = new Map(priorInputs.investments.map((item) => [
      String(record(item).id ?? ""),
      record(item),
    ]));
    const returnInputs = {
      ...projectionInputs,
      investments: projectionInputs.investments.map((item) => {
        const value = record(item);
        const previous = priorById.get(String(value.id ?? ""));
        const currentPrincipal = Number(value.investedAmount ?? 0);
        const priorPrincipal = Number(previous?.investedAmount ?? 0);
        const priorValue = Number(previous?.currentValue ?? priorPrincipal);
        return {
          ...value,
          currentValue: previous
            ? priorValue + (currentPrincipal - priorPrincipal)
            : currentPrincipal,
        };
      }),
    };
    const spendingKeys = [
      "lifestyleChoice", "customLifestyleExpense",
      "retirementSpendingAdjustmentPercent", "pensionSources",
    ];
    const spendingInputs = {
      ...projectionInputs,
      expenses: priorInputs.expenses,
      budgets: priorInputs.budgets,
      loans: priorInputs.loans,
      plannedExpenses: priorInputs.plannedExpenses,
      emergencyFund: priorInputs.emergencyFund,
      assumptions: {
        ...projectionInputs.assumptions,
        ...Object.fromEntries(spendingKeys.map((key) => [key, priorAssumptions[key]])),
      },
    };
    const assumptionKeys = [
      "dateOfBirth", "targetRetirementAge", "lifeExpectancy", "generalInflation", "salaryGrowth",
    ];
    const assumptionInputs = {
      ...projectionInputs,
      investments: mergePriorInvestmentFields(
        projectionInputs.investments,
        priorInputs.investments,
        ["expectedReturn"],
      ),
      assumptions: {
        ...projectionInputs.assumptions,
        ...Object.fromEntries(assumptionKeys.map((key) => [key, priorAssumptions[key]])),
      },
    };
    const candidates = [
      {
        changed: JSON.stringify([
          projectionInputs.incomes,
          contributionSignature(projectionInputs.investments),
          projectionInputs.assumptions.monthlyContributionOverride,
          projectionInputs.assumptions.investSurplus,
        ])
          !== JSON.stringify([
            priorInputs.incomes,
            contributionSignature(priorInputs.investments),
            priorAssumptions.monthlyContributionOverride,
            priorAssumptions.investSurplus,
          ]),
        inputs: contributionInputs,
        summary: `Contributions and invested principal changed from ₹${Math.round(priorForecast.assumptions.investedPrincipal ?? 0).toLocaleString("en-IN")} to ₹${Math.round(assumptions.investedPrincipal).toLocaleString("en-IN")} invested, with modeled monthly contributions changing from ₹${Math.round(priorForecast.assumptions.monthlyContribution).toLocaleString("en-IN")} to ₹${Math.round(assumptions.monthlyContribution).toLocaleString("en-IN")}.`,
      },
      {
        changed: assumptions.portfolioReturnAmount !== priorForecast.assumptions.portfolioReturnAmount,
        inputs: returnInputs,
        summary: `Portfolio returns after invested principal changed by ₹${Math.round(assumptions.portfolioReturnAmount - (priorForecast.assumptions.portfolioReturnAmount ?? 0)).toLocaleString("en-IN")}.`,
      },
      {
        changed: JSON.stringify([projectionInputs.expenses, projectionInputs.budgets, projectionInputs.loans, projectionInputs.plannedExpenses, projectionInputs.emergencyFund, spendingKeys.map((key) => projectionInputs.assumptions[key])])
          !== JSON.stringify([spendingInputs.expenses, spendingInputs.budgets, spendingInputs.loans, spendingInputs.plannedExpenses, spendingInputs.emergencyFund, spendingKeys.map((key) => spendingInputs.assumptions[key])]),
        inputs: spendingInputs,
        summary: `Modeled monthly spending changed from ₹${Math.round(priorForecast.assumptions.monthlySpending).toLocaleString("en-IN")} to ₹${Math.round(assumptions.monthlySpending).toLocaleString("en-IN")}.`,
      },
      {
        changed: JSON.stringify([assumptionKeys.map((key) => projectionInputs.assumptions[key]), projectionInputs.investments.map((item) => record(item).expectedReturn)])
          !== JSON.stringify([assumptionKeys.map((key) => assumptionInputs.assumptions[key]), assumptionInputs.investments.map((item) => record(item).expectedReturn)]),
        inputs: assumptionInputs,
        summary: "Retirement age, inflation, salary growth, life expectancy, or expected-return assumptions changed.",
      },
    ];
    for (const candidate of candidates.filter((item) => item.changed)) {
      const counterfactual = runRetirementForecast(candidate.inputs, asOfDate);
      driverCandidates.push({
        magnitude: modeledMonthImpact(projectedRetirementMonth, counterfactual.projectedRetirementMonth),
        text: `${candidate.summary} ${modeledImpactText(projectedRetirementMonth, counterfactual.projectedRetirementMonth)}`,
      });
    }
  } else if (assumptions && priorForecast) {
    const observedReturn = assumptions.portfolioReturnAmount - (priorForecast.assumptions.portfolioReturnAmount ?? 0);
    [
      { magnitude: Math.abs(assumptions.monthlyContribution - priorForecast.assumptions.monthlyContribution), text: `Monthly retirement contributions changed from ₹${Math.round(priorForecast.assumptions.monthlyContribution).toLocaleString("en-IN")} to ₹${Math.round(assumptions.monthlyContribution).toLocaleString("en-IN")}.` },
      { magnitude: Math.abs(assumptions.monthlySpending - priorForecast.assumptions.monthlySpending), text: `Modeled monthly spending changed from ₹${Math.round(priorForecast.assumptions.monthlySpending).toLocaleString("en-IN")} to ₹${Math.round(assumptions.monthlySpending).toLocaleString("en-IN")}.` },
      { magnitude: Math.abs(observedReturn), text: `Portfolio returns after invested principal changed by ₹${Math.round(observedReturn).toLocaleString("en-IN")}.` },
    ].filter((item) => item.magnitude > 0).forEach((item) => driverCandidates.push(item));
  }
  const rankedDrivers = driverCandidates
    .sort((left, right) => right.magnitude - left.magnitude)
    .slice(0, 3)
    .map((item) => item.text);
  const retirementMovementMonths = projectedRetirementMonth && priorForecast?.projectedRetirementMonth
    ? monthIndex(projectedRetirementMonth) - monthIndex(priorForecast.projectedRetirementMonth)
    : undefined;
  const retirementOutcomeChanged = Boolean(priorForecast)
    && projectedRetirementMonth !== priorForecast?.projectedRetirementMonth;
  const forecastDrivers = !priorForecast
    ? ["This is the first reproducible retirement forecast snapshot."]
    : rankedDrivers.length
      ? rankedDrivers
      : retirementOutcomeChanged
        ? [`The modeled retirement outcome changed, but no single supported contribution, spending, return, or assumption change explains it. ${modeledImpactText(projectedRetirementMonth, priorForecast.projectedRetirementMonth)}`]
        : ["No material modeled contribution, spending, return, or assumption changes were recorded."];
  const actions = [
    ...(budget > 0 && expenses > budget ? ["Review categories that exceeded their plan."] : []),
    ...(receivedIncome > 0 && savings / receivedIncome < 0.2 ? ["Review one change that could improve next month's savings rate."] : []),
    "Review next month's calendar for large payments and deadlines.",
    "Confirm recurring income and investment schedules are still accurate.",
    "Review retirement assumptions after any major financial change.",
  ].slice(0, 3);
  const sections = [
    {
      id: sectionIds[0], title: "Income vs expected",
      metrics: {
        actual: receivedIncome,
        expected: expectedIncome,
        variance: receivedIncome - expectedIncome,
      },
      metricFormats: { actual: "currency", expected: "currency", variance: "currency" },
      actions: [],
    },
    {
      id: sectionIds[1], title: "Expenses vs budget and category",
      metrics: { actual: expenses, budget, variance: expenses - budget, categoryCount: Object.keys(categoryTotals).length, categoriesOverBudget: categoryVariances.filter((value) => value > 0).length, largestCategoryVariance: Math.max(0, ...categoryVariances), topCategorySpend },
      metricFormats: { actual: "currency", budget: "currency", variance: "currency", categoryCount: "count", categoriesOverBudget: "count", largestCategoryVariance: "currency", topCategorySpend: "currency" },
      actions: Object.keys(categoryTotals).length ? [`Largest category: ${topCategory}.`] : ["No expenses were recorded for this month."],
    },
    {
      id: sectionIds[2], title: "Savings amount and rate",
      metrics: { amount: savings, rate: receivedIncome > 0 ? savings / receivedIncome * 100 : 0 },
      metricFormats: { amount: "currency", rate: "percent" },
      actions: [],
    },
    {
      id: sectionIds[3], title: "Portfolio value and returns change",
      metrics: {
        ...(portfolioMeasured ? { value: portfolio, invested } : {}),
        ...(portfolioReturnChange !== undefined ? { returnChange: portfolioReturnChange } : {}),
        ...(portfolioReturnPercent !== undefined ? { returnPercent: portfolioReturnPercent } : {}),
      },
      metricFormats: {
        ...(portfolioMeasured ? { value: "currency", invested: "currency" } : {}),
        ...(portfolioReturnChange !== undefined ? { returnChange: "currency" } : {}),
        ...(portfolioReturnPercent !== undefined ? { returnPercent: "percent" } : {}),
      },
      unavailableMetrics: [
        ...(!portfolioMeasured ? ["value", "invested", "returnPercent"] : portfolioReturnPercent === undefined ? ["returnPercent"] : []),
        ...(portfolioReturnChange === undefined ? ["returnChange"] : []),
      ],
      actions: portfolioMeasured
        ? (portfolioReturnChange === undefined ? ["Previous measured portfolio value and contributions are unavailable."] : [])
        : ["Historical portfolio balances were not measured for this month."],
    },
    {
      id: sectionIds[4], title: "Net-worth change",
      metrics: {
        ...(netWorth !== undefined ? { value: netWorth } : {}),
        ...(netWorth !== undefined && previousNetWorth !== undefined
          ? { change: netWorth - previousNetWorth }
          : {}),
      },
      metricFormats: {
        ...(netWorth !== undefined ? { value: "currency" } : {}),
        ...(netWorth !== undefined && previousNetWorth !== undefined ? { change: "currency" } : {}),
      },
      unavailableMetrics: [
        ...(netWorth === undefined ? ["value"] : []),
        ...(netWorth === undefined || previousNetWorth === undefined ? ["change"] : []),
      ],
      actions: netWorth === undefined
        ? ["No net-worth measurement was saved for this month."]
        : previousNetWorth === undefined
          ? ["No previous net-worth measurement is available for comparison."]
          : [],
    },
    {
      id: sectionIds[5], title: "Retirement-date movement",
      metrics: {
        ...(targetAgeMonths !== undefined ? { targetAgeMonths } : {}),
        ...(projectedRetirementAge !== null ? { projectedAgeMonths: projectedRetirementAge * 12 } : {}),
        ...(retirementMovementMonths !== undefined
          ? { movementMonths: retirementMovementMonths }
          : {}),
      },
      metricFormats: {
        ...(targetAgeMonths !== undefined ? { targetAgeMonths: "number" } : {}),
        ...(projectedRetirementAge !== null ? { projectedAgeMonths: "number" } : {}),
        ...(retirementMovementMonths !== undefined ? { movementMonths: "number" } : {}),
      },
      unavailableMetrics: [
        ...(targetAgeMonths === undefined ? ["targetAgeMonths"] : []),
        ...(forecastMeasured && projectedRetirementAge === null ? ["projectedAgeMonths"] : []),
        ...(forecastMeasured && retirementMovementMonths === undefined ? ["movementMonths"] : []),
        ...(!forecastMeasured && (targetAgeMonths === undefined || priorTargetAgeMonths === undefined)
          ? ["movementMonths"]
          : []),
      ],
      actions: targetAgeMonths === undefined
        ? ["No retirement-target measurement was saved for this month."]
        : priorTargetAgeMonths === undefined
          ? ["No previous retirement target is available for comparison."]
          : forecastDrivers,
    },
    {
      id: sectionIds[6], title: "Health-score change",
      metrics: {
        ...(healthScore !== undefined ? { score: healthScore } : {}),
        ...(healthScore !== undefined && previousHealthScore !== undefined
          ? { change: healthScore - previousHealthScore }
          : {}),
      },
      metricFormats: {
        ...(healthScore !== undefined ? { score: "number" } : {}),
        ...(healthScore !== undefined && previousHealthScore !== undefined ? { change: "number" } : {}),
      },
      unavailableMetrics: [
        ...(healthScore === undefined ? ["score"] : []),
        ...(healthScore === undefined || previousHealthScore === undefined ? ["change"] : []),
      ],
      actions: healthScore === undefined
        ? ["No health-score measurement was saved for this month."]
        : previousHealthScore === undefined
          ? ["No previous health-score measurement is available for comparison."]
          : [],
    },
    {
      id: sectionIds[7], title: "Top 3 next-month actions",
      metrics: { count: actions.length },
      metricFormats: { count: "count" },
      actions,
    },
  ];
  const generatedAt = options.generatedAt instanceof Date && Number.isFinite(options.generatedAt.getTime())
    ? options.generatedAt
    : new Date();
  return {
    id: `monthly-report-${month}`, month, generatedAt: generatedAt.toISOString(),
    ...(assumptions ? {
      retirementForecast: {
        modelVersion: RETIREMENT_FORECAST_MODEL_VERSION,
        projectedRetirementMonth,
        projectedRetirementAge,
        asOfDate,
        assumptions,
        projectionInputs,
        drivers: forecastDrivers,
      },
    } : {}),
    sections,
  };
}

export function mergeMonthEndForecast(
  existingReport: StoredMonthlyReportSnapshot | undefined,
  generatedReport: StoredMonthlyReportSnapshot | undefined,
): StoredMonthlyReportSnapshot | undefined {
  if (!existingReport) return generatedReport;
  if (existingReport.retirementForecast || !generatedReport?.retirementForecast) {
    return existingReport;
  }
  return {
    ...existingReport,
    retirementForecast: generatedReport.retirementForecast,
    sections: existingReport.sections.map((section) =>
      section.id === "retirement-date-movement"
        ? generatedReport.sections.find((item) => item.id === section.id) ?? section
        : section),
  };
}
function dateParts(value: unknown) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").slice(0, 10));
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
    return undefined;
  }
  return { year, month, day };
}

export function scheduledRetirementContributionFacts(
  data: Awaited<ReturnType<typeof loadFinancialData>>,
  localDate: string,
) {
  const today = dateParts(localDate);
  if (!today) return undefined;
  const projection = calculateRetirementProjection({
    expenses: data.expenses as never,
    budgets: data.budgets as never,
    incomes: data.incomeSources as never,
    investments: data.investments as never,
    loans: data.loans as never,
    plannedExpenses: data.plannedExpenses as never,
    emergencyFund: data.emergencyFund as never,
    assumptions: {
      ...data.retirementInputs,
      dateOfBirth: data.profileInputs?.dateOfBirth ?? "",
    } as never,
    asOf: new Date(today.year, today.month - 1, today.day, 12),
  });
  return {
    retirementContribution: projection.modeledMonthlyContribution,
    retirementContributionNeeded:
      projection.modeledMonthlyContribution + projection.extraSipRequired,
    extraSipRequired: projection.extraSipRequired,
  };
}

export function rules(data: Awaited<ReturnType<typeof loadFinancialData>>, localDate: string, now: Date) {
  const items: Array<{ type: string; key: string; title: string; message: string }> = [];
  const add = (type: string, key: string, title: string, message: string) => items.push({ type, key, title, message });
  const month = localDate.slice(0, 7);
  const retirementDate = retirementDateForData(data);
  const budget = data.budgets.reduce<number>(
    (sum, item) => sum + budgetAmountForMonth(item, month, retirementDate), 0,
  );
  const monthExpenses = data.expenses.filter((item) => String((item as { date?: string }).date).slice(0, 7) === month);
  const spent = monthExpenses.reduce<number>((sum, item) => sum + Number((item as { amount?: number }).amount ?? 0), 0);
  if (budget > 0 && spent > budget) add("budget", `budget:${localDate.slice(0, 7)}`, "Budget needs review", "This month's recorded spending exceeds your budget.");
  const monthlyInvestment = data.investments.reduce<number>((sum, raw) => {
    const item = raw as {
      monthlyContribution?: number; contributionStartDate?: string;
      contributionEndMode?: string; contributionEndDate?: string;
    };
    const start = item.contributionStartDate?.slice(0, 7);
    const end = item.contributionEndMode === "custom"
      ? item.contributionEndDate?.slice(0, 7)
      : item.contributionEndMode === "retirement"
        ? retirementDate?.slice(0, 7)
        : undefined;
    return sum + ((!start || start <= month) && (!end || end >= month)
      ? Number(item.monthlyContribution ?? 0)
      : 0);
  }, 0);
  const retirementFacts = scheduledRetirementContributionFacts(data, localDate);
  const plannedRetirementContribution = data.retirementInputs.monthlyContributionOverride ?? 0;
  const hasRetirementGap = retirementFacts
    ? retirementFacts.retirementContributionNeeded > retirementFacts.retirementContribution + 0.005
    : (plannedRetirementContribution > 0 && monthlyInvestment < plannedRetirementContribution)
      || (data.investments.length > 0 && monthlyInvestment <= 0);
  if (hasRetirementGap) {
    add(
      "retirement",
      `retirement:${localDate.slice(0, 7)}`,
      "Retirement contribution review",
      "Your recorded monthly investments are below the contribution in your retirement plan.",
    );
  }
  for (const goal of data.goals ?? []) {
    const months = Math.max(0, monthIndex(goal.targetDate.slice(0, 7)) - monthIndex(month));
    const inflationRate = Math.min(0.25, Math.max(0, Number(goal.annualInflationRate ?? 0)) / 100);
    const inflatedTarget = Math.max(0, goal.targetAmount) * Math.pow(1 + inflationRate, months / 12);
    const remaining = Math.max(0, inflatedTarget - Math.max(0, goal.currentAmount));
    const required = months > 0 ? remaining / months : remaining;
    if (goal.currentAmount < inflatedTarget
      && (goal.targetDate < localDate || goal.monthlyAllocation + 0.005 < required)) {
      add("goal", `goal:${goal.id}`, "Goal needs attention", `${goal.name} is behind.`);
    }
  }
  for (const event of scheduledEvents(data, localDate, addDays(localDate, 7))) {
    add("upcoming", `upcoming:${event.id}`, "Upcoming financial event", `${event.title} is due ${event.date}.`);
  }
  const portfolio = data.investments.reduce<number>((sum, item) => sum + Number((item as { currentValue?: number }).currentValue ?? 0), 0);
  const invested = data.investments.reduce<number>((sum, item) => sum + Number((item as { investedAmount?: number }).investedAmount ?? 0), 0);
  if (invested > 0 && portfolio / invested * 100 >= 25) {
    const milestone = Math.floor((portfolio / invested * 100) / 25) * 25;
    add("milestone", `milestone:${milestone}`, "Portfolio milestone", `You reached ${milestone}%.`);
  }
  const taxDeadline = [
    `${localDate.slice(0, 4)}-03-15`,
    `${localDate.slice(0, 4)}-06-15`,
    `${localDate.slice(0, 4)}-09-15`,
    `${localDate.slice(0, 4)}-12-15`,
    `${Number(localDate.slice(0, 4)) + 1}-03-15`,
  ].find((deadline) => deadline >= localDate);
  if (taxDeadline) {
    const daysUntilTax = Math.round(
      (new Date(`${taxDeadline}T00:00:00Z`).getTime() - new Date(`${localDate}T00:00:00Z`).getTime())
      / 86_400_000,
    );
    if (daysUntilTax <= 14) {
      add(
        "tax",
        `tax:${taxDeadline}`,
        "Advance tax deadline approaching",
        "Review your advance-tax estimate before the upcoming deadline.",
      );
    }
  }
  const average = monthExpenses.length > 1 ? spent / monthExpenses.length : 0;
  const anomalous = monthExpenses
    .map((item) => item as { id?: string; amount?: number })
    .filter((item) => Number(item.amount ?? 0) >= Math.max(5_000, average * 2))
    .sort((left, right) => Number(right.amount ?? 0) - Number(left.amount ?? 0))[0];
  if (anomalous) add("anomaly", `anomaly:${anomalous.id}`, "Unusual expense", "Review an expense outside your normal range.");
  return items;
}

export function shouldSendMonthlyReportEmail(prefs: Preferences, email: string | null): boolean {
  return prefs.enabled && prefs.monthlyReportEmail && Boolean(email);
}

export function classifyMonthlyReportDeliveryFailure(
  error: unknown,
): "report_too_large" | "email_unavailable" | "temporary" {
  if (error instanceof MonthlyReportAttachmentTooLargeError) return "report_too_large";
  if (error instanceof Error && error.message === "Monthly report email is not configured") {
    return "email_unavailable";
  }
  return "temporary";
}

export function selectPushableNotifications(notifications: Notice[], prefs: Preferences, now: Date): Notice[] {
  if (!prefs.enabled || !prefs.push) return [];
  if (prefs.timeZone && prefs.quietHours && quietUntil(now, prefs).getTime() > now.getTime()) return [];
  return notifications.filter((item) =>
    item.channels.includes("push")
    && prefs.types[item.type] === true
    && !item.dismissedAt
    && !item.pushDeliveredAt
    && new Date(item.deliverAfter) <= now);
}

export async function processMonthlyReport(input: {
  persisted: boolean;
  emailDelivered: boolean;
  shouldEmail: boolean;
  persist: () => Promise<void>;
  clearEmailFailure?: () => Promise<void>;
  send: () => Promise<void>;
  markEmailDelivered: () => Promise<void>;
  markEmailFailed: (category: ReturnType<typeof classifyMonthlyReportDeliveryFailure>) => Promise<void>;
}) {
  if (!input.persisted) await input.persist();
  if (!input.shouldEmail || input.emailDelivered) return { emailDelivered: input.emailDelivered };
  await input.clearEmailFailure?.();
  try {
    await input.send();
  } catch (error) {
    const deliveryFailure = classifyMonthlyReportDeliveryFailure(error);
    await input.markEmailFailed(deliveryFailure);
    return {
      emailDelivered: false,
      deliveryFailure,
    };
  }
  try {
    await input.markEmailDelivered();
    return { emailDelivered: true };
  } catch {
    return { emailDelivered: true, deliveryStatusPending: true };
  }
}

async function evaluatePlanningForAccountFenced(
  user: typeof usersTable.$inferSelect,
  now: Date,
) {
  const data = await loadFinancialData(user), prefs = data.notificationPreferences, local = localParts(now, prefs.timeZone), date = dateKey(local);
  const prior = previousMonth(now, prefs.timeZone);
  const existingReport = (data.monthlyReports ?? []).find((item) => item.month === prior);
  const report = !existingReport?.retirementForecast;
  const generatedReport = report ? reportFor(data, prior, {
      generatedAt: now,
      // Only the first local day is close enough to month end to treat the live
      // investment balances as a closing measurement. Catch-up runs stay honest.
      captureLivePortfolio: local.day === 1,
      captureLiveRetirementTarget: local.day === 1,
      captureLiveRetirementForecast: local.day === 1,
    }) : undefined;
  const snapshot = mergeMonthEndForecast(existingReport, generatedReport);
  if (!snapshot) throw new Error(`Monthly report ${prior} could not be generated`);
  const reportEmailDeliveries = await loadMonthlyReportEmailDeliveriesForUser(user.id);
  await processMonthlyReport({
    persisted: Boolean(existingReport?.retirementForecast),
    emailDelivered: Boolean(reportEmailDeliveries[prior]),
    shouldEmail: shouldSendMonthlyReportEmail(prefs, user.email),
    persist: () => updatePlanningFeatures(user, { monthlyReportSnapshot: snapshot }).then(() => undefined),
    ...(data.monthlyReportEmailFailures[prior]
      ? {
          clearEmailFailure: () => updatePlanningFeatures(user, {
            monthlyReportEmailClearFailureMonth: prior,
          }).then(() => undefined),
        }
      : {}),
    send: () => sendMonthlyReportEmail(user.email!, snapshot),
    markEmailDelivered: () => updatePlanningFeatures(
      user,
      { monthlyReportEmailDeliveredMonth: prior },
    ).then(() => undefined),
    markEmailFailed: (category) => updatePlanningFeatures(user, {
      monthlyReportEmailFailure: { month: prior, category, failedAt: now.toISOString() },
    }).then(() => undefined),
  });
  if (!prefs.enabled) return { notifications: 0, report };
  const deliverAfter = quietUntil(now, prefs).toISOString(), channels = [prefs.inApp ? "in-app" : undefined, prefs.push && vapidConfigured() ? "push" : undefined].filter((item): item is "in-app" | "push" => Boolean(item));
  const evaluatedRules = rules(data, date, now);
  for (const item of evaluatedRules.filter((item) => prefs.types[item.type])) await updatePlanningFeatures(user, { notification: { id: crypto.randomUUID(), dedupeKey: item.key, type: item.type, title: item.title, message: item.message, createdAt: now.toISOString(), deliverAfter, channels } });
  const subscriptions = await loadPushSubscriptionsForUser(user.id);
  // Consent is reloaded after all queued writes and immediately before any
  // external delivery, so an opt-out made during evaluation wins.
  const refreshed = await loadFinancialData(user);
  const currentPrefs = refreshed.notificationPreferences;
  const pushable = selectPushableNotifications((refreshed.notifications ?? []) as Notice[], currentPrefs, now);
  await deliverPush(user, pushable, subscriptions);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: currentPrefs.timeZone, weekday: "short" }).format(now);
  const weekdayNumber = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  if (currentPrefs.enabled && currentPrefs.weeklyDigest && weekdayNumber === currentPrefs.digestDay && user.email) {
    const unread = (refreshed.notifications ?? []).filter((item) => !item.readAt && !item.dismissedAt).length;
    await sendDigest(user.email, unread, `planning-digest-${user.id}-${date}`);
  }
  return { notifications: evaluatedRules.length, report };
}

const deletionLifecycleStatuses = ["cooling_off", "processing", "blocked", "completed"] as const;

export async function evaluatePlanningForAccount(
  user: typeof usersTable.$inferSelect,
  now = new Date(),
) {
  return withAccountWriteFence(user.id, async () => {
    // The scheduler's initial user list is only a work queue. Identity and
    // deletion lifecycle state must be read again after this account's fence
    // admits the job, before any report write or external delivery.
    const [[currentUser], [deletionRequest]] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1),
      db.select({ id: accountDeletionRequestsTable.id })
        .from(accountDeletionRequestsTable)
        .where(and(
          or(
            eq(accountDeletionRequestsTable.userId, user.id),
            eq(accountDeletionRequestsTable.accountHash, accountHash(user.id)),
          ),
          inArray(accountDeletionRequestsTable.status, deletionLifecycleStatuses),
        ))
        .limit(1),
    ]);
    if (!currentUser || deletionRequest) {
      return { notifications: 0, report: false, skipped: true as const };
    }
    return evaluatePlanningForAccountFenced(currentUser, now);
  });
}

export async function evaluatePlanning(
  userId?: string,
  options: { limit?: number; budgetMs?: number; now?: () => number } = {},
) {
  const clock = options.now ?? Date.now;
  const deadline = clock() + Math.max(1, options.budgetMs ?? PLANNING_INVOCATION_BUDGET_MS);
  const limit = Math.max(1, Math.min(options.limit ?? PLANNING_INVOCATION_LIMIT, 100));
  const users = userId
    ? await db.select().from(usersTable).where(eq(usersTable.id, userId))
    : await claimPlanningPage(limit);
  const results: Array<PromiseSettledResult<Awaited<ReturnType<typeof evaluatePlanningForAccount>>>> = [];
  for (const user of users) {
    if (clock() >= deadline - PLANNING_ADMISSION_RESERVE_MS) break;
    try {
      const value = await evaluatePlanningForAccount(user);
      results.push({ status: "fulfilled", value });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }
  return {
    evaluated: results.filter((result) =>
      result.status === "fulfilled" && !("skipped" in result.value)).length,
    failed: results.filter((result) => result.status === "rejected").length,
    claimed: users.length,
    deadlineReached: clock() >= deadline,
  };
}

export async function claimPlanningPage(limit: number): Promise<Array<typeof usersTable.$inferSelect>> {
  return db.transaction(async (tx) => {
    await tx.insert(planningSchedulerStateTable).values({ id: "global" })
      .onConflictDoNothing({ target: planningSchedulerStateTable.id });
    const [state] = await tx.select().from(planningSchedulerStateTable)
      .where(eq(planningSchedulerStateTable.id, "global")).for("update");
    const eligible = sql`not exists (
      select 1 from account_deletion_requests deletion
      where deletion.user_id = ${usersTable.id}
        and deletion.status in ('cooling_off', 'processing', 'blocked', 'completed')
    )`;
    const after = state?.cursorUserId
      ? await tx.select().from(usersTable).where(and(
        eligible,
        gt(usersTable.id, state.cursorUserId),
      )).orderBy(asc(usersTable.id)).limit(limit)
      : await tx.select().from(usersTable).where(eligible)
        .orderBy(asc(usersTable.id)).limit(limit);
    const remaining = limit - after.length;
    const wrapped = remaining > 0 && state?.cursorUserId
      ? await tx.select().from(usersTable).where(and(
        eligible,
        lte(usersTable.id, state.cursorUserId),
      )).orderBy(asc(usersTable.id)).limit(remaining)
      : [];
    const page = [...after, ...wrapped];
    if (page.length) {
      await tx.update(planningSchedulerStateTable).set({
        cursorUserId: page.at(-1)!.id,
        updatedAt: new Date(),
      }).where(eq(planningSchedulerStateTable.id, "global"));
    }
    return page;
  });
}

function mergePriorInvestmentFields(
  current: unknown[],
  prior: unknown[],
  fields: string[],
) {
  const priorById = new Map(prior.map((item) => [String(record(item).id ?? ""), record(item)]));
  return current.map((item) => {
    const value = record(item);
    const previous = priorById.get(String(value.id ?? ""));
    return Object.fromEntries(Object.entries(value).map(([key, fieldValue]) => [
      key,
      fields.includes(key) && previous && key in previous ? previous[key] : fieldValue,
    ]));
  });
}

function runRetirementForecast(inputs: ForecastInputs, asOfDate: string) {
  const args = {
    expenses: inputs.expenses as never,
    budgets: inputs.budgets as never,
    incomes: inputs.incomes as never,
    investments: inputs.investments as never,
    loans: inputs.loans as never,
    plannedExpenses: inputs.plannedExpenses as never,
    emergencyFund: inputs.emergencyFund as never,
    assumptions: inputs.assumptions as never,
    asOf: new Date(`${asOfDate}T12:00:00`),
  };
  const readiness = calculateRetirementReadiness(args);
  const projection = calculateRetirementProjection(args);
  const projectedRetirementAge = readiness.currentPlanRetirementAge;
  const birth = dateParts(inputs.assumptions.dateOfBirth);
  const birthdayMonth = birth && projectedRetirementAge !== null
    ? `${birth.year + projectedRetirementAge}-${String(birth.month).padStart(2, "0")}`
    : null;
  const asOfMonth = asOfDate.slice(0, 7);
  return {
    projection,
    projectedRetirementAge,
    projectedRetirementMonth: birthdayMonth && monthIndex(birthdayMonth) < monthIndex(asOfMonth)
      ? asOfMonth
      : birthdayMonth,
  };
}

function modeledImpactText(current: string | null, counterfactual: string | null) {
  if (current === counterfactual) return "It did not change the modeled retirement month.";
  if (!current || !counterfactual) return "It changed whether the plan funds retirement before life expectancy.";
  const movement = monthIndex(current) - monthIndex(counterfactual);
  return `It moved the modeled retirement date about ${Math.abs(movement)} month${Math.abs(movement) === 1 ? "" : "s"} ${movement < 0 ? "earlier" : "later"}.`;
}

function neutralizeContributionChanges(current: unknown[], prior: unknown[]) {
  const currentIds = new Set(current.map((item) => String(record(item).id ?? "")));
  const priorById = new Map(prior.map((item) => [String(record(item).id ?? ""), record(item)]));
  const contributionFields = [
    "monthlyContribution", "contributionStartDate", "contributionEndMode",
    "contributionEndDate", "linkedIncomeSourceId", "fundAllocations",
  ];
  const restoredCurrent = current.map((item) => {
    const value = record(item);
    const previous = priorById.get(String(value.id ?? ""));
    const currentPrincipal = Number(value.investedAmount ?? 0);
    const priorPrincipal = Number(previous?.investedAmount ?? 0);
    const restored: Record<string, unknown> = {
      ...value,
      investedAmount: priorPrincipal,
      currentValue: Number(value.currentValue ?? 0) - (currentPrincipal - priorPrincipal),
    };
    for (const key of contributionFields) {
      if (previous && key in previous) restored[key] = previous[key];
      else delete restored[key];
    }
    return restored;
  });
  const restoredRemoved = prior
    .map(record)
    .filter((item) => !currentIds.has(String(item.id ?? "")));
  return [...restoredCurrent, ...restoredRemoved];
}

function contributionSignature(investments: unknown[]) {
  return investments.map((item) => {
    const value = record(item);
    return [
      value.id, value.investedAmount, value.monthlyContribution,
      value.contributionStartDate, value.contributionEndMode,
      value.contributionEndDate, value.linkedIncomeSourceId, value.fundAllocations,
    ];
  }).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
}

function modeledMonthImpact(current: string | null, counterfactual: string | null) {
  if (current === counterfactual) return 0;
  if (!current || !counterfactual) return 125 * 12;
  return Math.abs(monthIndex(current) - monthIndex(counterfactual));
}

type ForecastInputs = {
  expenses: Array<Record<string, unknown>>;
  budgets: Array<Record<string, unknown>>;
  incomes: Array<Record<string, unknown>>;
  investments: Array<Record<string, unknown>>;
  loans: Array<Record<string, unknown>>;
  plannedExpenses: Array<Record<string, unknown>>;
  emergencyFund: Record<string, unknown>;
  assumptions: Record<string, unknown>;
};
