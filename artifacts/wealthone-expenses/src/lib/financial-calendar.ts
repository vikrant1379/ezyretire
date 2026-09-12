import {
  formatDateOnly,
  loanMonthlyPayment,
  parseDateOnly,
  type Budget,
  type FinancialReminder,
  type IncomeSource,
  type Investment,
  type Loan,
  type PlannedExpense,
} from "./storage.ts";
import { incomeOccurrenceNetAmount } from "./financial-metrics.ts";
import { loanPayoffDetails } from "./retirement-projection.ts";

export type FinancialCalendarEventKind =
  | "income" | "investment" | "investment-maturity" | "loan" | "budget" | "planned-expense" | "reminder" | "tax";

export type FinancialCalendarEvent = {
  id: string;
  kind: FinancialCalendarEventKind;
  title: string;
  date: string;
  amount?: number;
  sourceId: string;
};

export type FinancialCalendarInput = {
  from: string;
  through: string;
  incomes?: IncomeSource[];
  investments?: Investment[];
  loans?: Loan[];
  budgets?: Budget[];
  plannedExpenses?: PlannedExpense[];
  reminders?: FinancialReminder[];
  retirementDate?: string;
  asOf?: Date;
};

const monthOffset = (from: Date, to: Date) =>
  (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();

function occurrence(year: number, month: number, day: number) {
  return new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));
}

function recurringDates(anchorValue: string, cadence: "monthly" | "yearly", from: Date, through: Date) {
  const anchor = parseDateOnly(anchorValue);
  if (!Number.isFinite(anchor.getTime())) return [];
  const dates: Date[] = [];
  for (let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    cursor <= through;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    if (cadence === "yearly" && cursor.getMonth() !== anchor.getMonth()) continue;
    const date = occurrence(cursor.getFullYear(), cursor.getMonth(), anchor.getDate());
    if (date >= anchor && date >= from && date <= through) dates.push(date);
  }
  return dates;
}

function nextLoanPaymentDate(startDate: string, asOf: Date) {
  const start = parseDateOnly(startDate);
  if (!Number.isFinite(start.getTime())) return undefined;
  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  if (start >= today) return start;
  let next = occurrence(today.getFullYear(), today.getMonth(), start.getDate());
  if (next < today) next = occurrence(today.getFullYear(), today.getMonth() + 1, start.getDate());
  return next;
}

export function generateFinancialCalendar(input: FinancialCalendarInput): FinancialCalendarEvent[] {
  const from = parseDateOnly(input.from);
  const through = parseDateOnly(input.through);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(through.getTime()) || through < from) return [];
  const events: FinancialCalendarEvent[] = [];
  const add = (event: FinancialCalendarEvent) => events.push(event);
  for (const income of input.incomes ?? []) {
    const cadence = income.frequency === "Monthly" ? "monthly" : "yearly";
    const dates = income.recurring && income.frequency !== "One-time"
      ? recurringDates(income.date, cadence, from, through)
      : [parseDateOnly(income.date)].filter((date) => date >= from && date <= through);
    dates.filter((date) => {
      const endDate = income.incomeEndMode === "custom"
        ? income.incomeEndDate
        : income.incomeEndMode === "retirement"
          ? input.retirementDate
          : undefined;
      return !endDate || date <= parseDateOnly(endDate);
    })
      .forEach((date) => add({
      id: `income:${income.id}:${formatDateOnly(date)}`, kind: "income",
      title: income.name, date: formatDateOnly(date), amount: incomeOccurrenceNetAmount(income), sourceId: income.id,
    }));
  }
  for (const investment of input.investments ?? []) {
    if (Number(investment.monthlyContribution) > 0) {
      const anchor = investment.contributionStartDate ?? input.from;
      recurringDates(anchor, "monthly", from, through)
        .filter((date) => {
          const endDate = investment.contributionEndMode === "custom"
            ? investment.contributionEndDate
            : investment.contributionEndMode === "retirement"
              ? input.retirementDate
              : undefined;
          return !endDate || date <= parseDateOnly(endDate);
        })
        .forEach((date) => add({
          id: `investment:${investment.id}:${formatDateOnly(date)}`, kind: "investment",
          title: `${investment.name} contribution`, date: formatDateOnly(date),
          amount: investment.monthlyContribution, sourceId: investment.id,
        }));
    }
    const maturity = investment.maturityDate ? parseDateOnly(investment.maturityDate) : undefined;
    if (maturity && maturity >= from && maturity <= through) add({
      id: `investment-maturity:${investment.id}:${formatDateOnly(maturity)}`,
      kind: "investment-maturity", title: `${investment.name} matures`,
      date: formatDateOnly(maturity), amount: investment.currentValue, sourceId: investment.id,
    });
  }
  // Indian advance-tax instalment dates are useful even when no reminder was created.
  for (let year = from.getFullYear() - 1; year <= through.getFullYear() + 1; year += 1) {
    for (const suffix of ["03-15", "06-15", "09-15", "12-15"]) {
      const date = parseDateOnly(`${year}-${suffix}`);
      if (date >= from && date <= through) add({
        id: `tax:${formatDateOnly(date)}`, kind: "tax", title: "Advance tax deadline",
        date: formatDateOnly(date), sourceId: `tax-${formatDateOnly(date)}`,
      });
    }
  }
  for (const loan of input.loans ?? []) {
    const asOf = input.asOf instanceof Date && Number.isFinite(input.asOf.getTime())
      ? input.asOf
      : new Date();
    const payoff = loanPayoffDetails(loan, asOf);
    const firstPayment = nextLoanPaymentDate(loan.startDate, asOf);
    if (!firstPayment || payoff.remainingPrincipal <= 0 || payoff.remainingMonths <= 0) continue;
    const repaymentType = loan.repaymentType ?? "emi";
    let dates: Date[];
    let principalDueDate: Date | undefined;
    if (repaymentType === "emi") {
      dates = recurringDates(formatDateOnly(firstPayment), "monthly", from, through)
        .filter((date) => monthOffset(firstPayment, date) < payoff.remainingMonths);
    } else {
      const start = parseDateOnly(loan.startDate);
      const maturity = occurrence(
        start.getFullYear(),
        start.getMonth() + Math.max(1, loan.totalTenureMonths) - 1,
        start.getDate(),
      );
      const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
      if (maturity < today || repaymentType === "bullet") {
        const due = maturity < today ? firstPayment : maturity;
        principalDueDate = due;
        dates = due >= from && due <= through ? [due] : [];
      } else {
        principalDueDate = maturity;
        dates = recurringDates(formatDateOnly(firstPayment), "monthly", from, through)
          .filter((date) => date <= maturity);
      }
    }
    const monthlyInterest = payoff.remainingPrincipal * Math.max(0, loan.annualInterestRate) / 1200;
    dates.forEach((date, index) => {
      const finalPayment = repaymentType === "emi"
        ? monthOffset(firstPayment, date) === payoff.remainingMonths - 1
        : principalDueDate !== undefined && formatDateOnly(date) === formatDateOnly(principalDueDate);
      const amount = repaymentType === "bullet"
        ? payoff.remainingPrincipal + monthlyInterest * Math.max(1, payoff.remainingMonths)
        : repaymentType === "interest-only-plus-bullet"
          ? monthlyInterest + (finalPayment ? payoff.remainingPrincipal : 0)
          : loanMonthlyPayment(loan);
      add({
        id: `loan:${loan.id}:${formatDateOnly(date)}`, kind: "loan", title: `${loan.name} payment`,
        date: formatDateOnly(date), amount, sourceId: loan.id,
      });
    });
  }
  for (const budget of input.budgets ?? []) for (const window of budget.windows ?? []) {
    const cadence = window.cadence ?? "monthly";
    const anchor = cadence === "yearly" && Number.isInteger(window.annualMonth)
      ? formatDateOnly(new Date(from.getFullYear(), window.annualMonth!, 1))
      : window.startDate ?? input.from;
    const anchorDate = parseDateOnly(anchor);
    const dates = cadence === "one-time"
      ? [parseDateOnly(anchor)].filter((date) => date >= from && date <= through)
      : recurringDates(anchor, cadence === "yearly" ? "yearly" : "monthly", from, through)
        .filter((date) => cadence === "monthly"
          || cadence === "yearly"
          || monthOffset(anchorDate, date) % (cadence === "quarterly" ? 3 : 6) === 0);
    dates.filter((date) => {
      const endDate = window.endMode === "custom"
        ? window.endDate
        : window.endMode === "retirement"
          ? input.retirementDate
          : undefined;
      return (!window.startDate || date >= parseDateOnly(window.startDate))
        && (!endDate || date <= parseDateOnly(endDate));
    })
      .forEach((date) => add({
        id: `budget:${window.id}:${formatDateOnly(date)}`, kind: "budget", title: `${budget.category} budget`,
        date: formatDateOnly(date), amount: window.monthlyLimit,
        sourceId: window.id,
      }));
  }
  (input.plannedExpenses ?? []).forEach((expense) => {
    const date = parseDateOnly(expense.expectedDate);
    if (date >= from && date <= through) add({
      id: `planned:${expense.id}:${formatDateOnly(date)}`, kind: "planned-expense", title: expense.name,
      date: formatDateOnly(date), amount: expense.amount, sourceId: expense.id,
    });
  });
  for (const reminder of input.reminders ?? []) {
    if (!reminder.enabled) continue;
    const dates = reminder.recurrence === "none"
      ? [parseDateOnly(reminder.date)].filter((date) => date >= from && date <= through)
      : recurringDates(reminder.date, reminder.recurrence, from, through);
    dates.forEach((date) => add({
      id: `reminder:${reminder.id}:${formatDateOnly(date)}`, kind: "reminder", title: reminder.title,
      date: formatDateOnly(date), ...(reminder.amount !== undefined ? { amount: reminder.amount } : {}),
      sourceId: reminder.id,
    }));
  }
  return [...new Map(events.map((event) => [event.id, event])).values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function dateInTimeZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function calendarViews(events: FinancialCalendarEvent[], now: Date, timeZone: string, upcomingDays = 30) {
  const today = dateInTimeZone(now, timeZone);
  const end = parseDateOnly(today);
  end.setDate(end.getDate() + upcomingDays);
  const upcomingEnd = formatDateOnly(end);
  return {
    today: events.filter((event) => event.date === today),
    // Keep the most recent missed occurrence per recurring source, while retaining
    // every one-off historical obligation so the overdue list remains actionable.
    overdue: events.filter((event) =>
      event.date < today && (event.kind === "reminder" || event.kind === "planned-expense"))
      .reduce<FinancialCalendarEvent[]>((list, event) => {
      const recurring = ["income", "investment", "loan", "budget", "reminder"].includes(event.kind);
      const index = recurring ? list.findIndex((item) => item.sourceId === event.sourceId) : -1;
      if (index >= 0) list[index] = event;
      else list.push(event);
      return list;
    }, []).sort((a, b) => b.date.localeCompare(a.date)),
    upcoming: events.filter((event) => event.date > today && event.date <= upcomingEnd),
    month: events.filter((event) => event.date.slice(0, 7) === today.slice(0, 7)),
  };
}