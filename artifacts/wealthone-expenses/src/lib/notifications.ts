import { dateInTimeZone, type FinancialCalendarEvent } from "./financial-calendar.ts";
import { goalStatus, type GoalStatus } from "./goals.ts";
import {
  normalizeNotificationPreferences,
  type FinancialGoal,
  type NotificationItem,
  type NotificationPreferences,
  type NotificationType,
} from "./storage.ts";

export type NotificationFacts = {
  month: string;
  spent: number;
  budget: number;
  goals: FinancialGoal[];
  events: FinancialCalendarEvent[];
  portfolioMilestonePercent?: number;
  retirementContribution?: number;
  retirementContributionNeeded?: number;
  taxDueDate?: string;
  anomalousExpense?: { id: string; amount: number };
};

type Candidate = Pick<NotificationItem, "type" | "title" | "message"> & { subject: string };

function localClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: "hour" | "minute") => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

function quietDelivery(now: Date, preferences: NotificationPreferences) {
  const minutes = (clock: string) => {
    const [hour, minute] = clock.split(":").map(Number);
    return hour * 60 + minute;
  };
  const current = localClock(now, preferences.timeZone);
  const start = minutes(preferences.quietHours.start);
  const end = minutes(preferences.quietHours.end);
  const isQuiet = (localMinutes: number) => start === end ? false : start < end
    ? localMinutes >= start && localMinutes < end
    : localMinutes >= start || localMinutes < end;
  const quiet = isQuiet(current);
  if (!quiet) return now;
  // Advancing real minutes, then reading wall time in the requested zone,
  // remains correct across daylight-saving gaps and repeated hours.
  const firstMinute = new Date(Math.ceil(now.getTime() / 60_000) * 60_000);
  for (let offset = 0; offset <= 26 * 60; offset += 1) {
    const candidate = new Date(firstMinute.getTime() + offset * 60_000);
    if (!isQuiet(localClock(candidate, preferences.timeZone))) return candidate;
  }
  return firstMinute;
}

function candidate(type: NotificationType, subject: string, title: string, message: string): Candidate {
  return { type, subject, title, message };
}

/** Pure policy evaluation: consent, type controls, dedupe and quiet hours are all applied here. */
export function decideNotifications(
  facts: NotificationFacts,
  rawPreferences: NotificationPreferences,
  existing: Pick<NotificationItem, "dedupeKey">[],
  now: Date,
): NotificationItem[] {
  const preferences = normalizeNotificationPreferences(rawPreferences);
  if (!preferences.enabled) return [];
  const today = dateInTimeZone(now, preferences.timeZone);
  const candidates: Candidate[] = [];
  if (facts.budget > 0 && facts.spent > facts.budget) {
    candidates.push(candidate("budget", facts.month, "Budget exceeded", "Monthly spending is above budget."));
  }
  facts.goals.forEach((goal) => {
    const status: GoalStatus = goalStatus(goal, now);
    if (status === "behind" || status === "overdue") {
      candidates.push(candidate("goal", goal.id, "Goal needs attention", `${goal.name} is ${status}.`));
    }
  });
  facts.events.filter((event) => event.date >= today && event.date <= addDays(today, 7))
    .forEach((event) => candidates.push(candidate(
      "upcoming", event.id, "Upcoming financial event", `${event.title} is due ${event.date}.`,
    )));
  if ((facts.portfolioMilestonePercent ?? 0) >= 25) {
    const milestone = Math.floor((facts.portfolioMilestonePercent ?? 0) / 25) * 25;
    candidates.push(candidate("milestone", String(milestone), "Portfolio milestone", `You reached ${milestone}%.`));
  }
  if ((facts.retirementContributionNeeded ?? 0) > (facts.retirementContribution ?? 0)) {
    candidates.push(candidate("retirement", facts.month, "Retirement contribution gap", "Your contribution is below plan."));
  }
  if (facts.taxDueDate && facts.taxDueDate >= today && facts.taxDueDate <= addDays(today, 14)) {
    candidates.push(candidate("tax", facts.taxDueDate, "Tax deadline approaching", `Tax is due ${facts.taxDueDate}.`));
  }
  if (facts.anomalousExpense) {
    candidates.push(candidate("anomaly", facts.anomalousExpense.id, "Unusual expense", "Review an expense outside your normal range."));
  }
  const existingKeys = new Set(existing.map((item) => item.dedupeKey));
  const batchKeys = new Set<string>();
  const deliverAfter = quietDelivery(now, preferences).toISOString();
  const channels: NotificationItem["channels"] = [
    ...(preferences.inApp ? ["in-app" as const] : []),
    ...(preferences.push ? ["push" as const] : []),
  ];
  if (channels.length === 0) return [];
  return candidates.flatMap((item) => {
    if (!preferences.types[item.type]) return [];
    const dedupeKey = `${item.type}:${item.subject}`;
    if (existingKeys.has(dedupeKey) || batchKeys.has(dedupeKey)) return [];
    batchKeys.add(dedupeKey);
    return [{
      id: dedupeKey,
      dedupeKey,
      type: item.type,
      title: item.title,
      message: item.message,
      createdAt: now.toISOString(),
      deliverAfter,
      channels,
    }];
  });
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}