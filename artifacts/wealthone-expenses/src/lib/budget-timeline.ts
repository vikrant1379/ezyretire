import { isBefore, startOfMonth, parseISO, addMonths } from "date-fns";
import { type UIBudgetWindow } from "./budget-helpers.ts";

export type TimelineEvent = {
  date: Date;
  amountChange: number;
  newTotal: number;
  activeWindows: UIBudgetWindow[];
};

export type TimelineIssue = 
  | { type: "gap"; startDate: Date; endDate?: Date }
  | { type: "overlap"; amount: number; startDate: Date; endDate?: Date }
  | { type: "invalid-date"; windowId: string; reason: string };

function parseMonth(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const parsed = parseISO(dateStr);
  return isNaN(parsed.getTime()) ? null : startOfMonth(parsed);
}

export function analyzeBudgetTimeline(windows: UIBudgetWindow[], retirementEndDate?: string) {
  const issues: TimelineIssue[] = [];
  windows.forEach((window) => {
    if (window.cadence === "yearly"
      && (!Number.isInteger(window.annualMonth) || (window.annualMonth ?? -1) < 0 || (window.annualMonth ?? 12) > 11)) {
      issues.push({
        type: "invalid-date",
        windowId: window.id,
        reason: "Choose the month when this yearly expense is due.",
      });
    }
  });
  // The change story describes recurring monthly limits. Yearly charges are
  // intentionally presented as upcoming occurrences instead.
  const recurringWindows = windows.filter((window) => window.cadence !== "yearly");
  
  // Resolve dates for each window
  const resolvedWindows = recurringWindows.map(w => {
    let start = parseMonth(w.startDate) || startOfMonth(new Date());
    let end: Date | null = null;
    
    if (w.endMode === "custom") {
      end = parseMonth(w.endDate);
      if (!end) {
        issues.push({ type: "invalid-date", windowId: w.id, reason: "Choose an end month for this period." });
      }
    } else if (w.endMode === "retirement") {
      end = parseMonth(retirementEndDate);
      if (!end) {
        issues.push({ type: "invalid-date", windowId: w.id, reason: "Set your retirement date before using this end choice." });
      }
    }
    
    if (end && isBefore(end, start)) {
      issues.push({ type: "invalid-date", windowId: w.id, reason: "End date is before start date" });
    }
    
    return { ...w, start, end };
  });
  
  // Build events
  const dates = new Set<number>();
  resolvedWindows.forEach(w => {
    dates.add(w.start.getTime());
    if (w.end) {
      // End month is inclusive in UI, so the change happens the month after.
      dates.add(addMonths(w.end, 1).getTime());
    }
  });
  
  const sortedDates = Array.from(dates).sort();
  const timeline: TimelineEvent[] = [];
  
  let currentTotal = 0;
  
  sortedDates.forEach((time, index) => {
    const date = new Date(time);
    
    const activeWindows = resolvedWindows.filter(w => {
      const started = time >= w.start.getTime();
      const ended = w.end ? time >= addMonths(w.end, 1).getTime() : false;
      return started && !ended;
    });
    
    const newTotal = activeWindows.reduce((sum, w) => sum + (Number(w.monthlyLimit) || 0), 0);
    const amountChange = newTotal - currentTotal;
    
    timeline.push({ date, amountChange, newTotal, activeWindows });
    currentTotal = newTotal;
    
    // Check for gaps (0 total)
    if (newTotal === 0 && index < sortedDates.length - 1) {
      issues.push({
        type: "gap",
        startDate: date,
        endDate: addMonths(new Date(sortedDates[index + 1]), -1),
      });
    }
    
    // Overlaps: Multiple windows active simultaneously.
    if (activeWindows.length > 1) {
      const nextTime = index < sortedDates.length - 1
        ? addMonths(new Date(sortedDates[index + 1]), -1)
        : undefined;
      // High overlap warning: maybe total is very high or just simply having >1 window active
      issues.push({ type: "overlap", amount: newTotal, startDate: date, endDate: nextTime });
    }
  });

  if (resolvedWindows.length > 0 && sortedDates.length > 0) {
    const finalDate = new Date(sortedDates[sortedDates.length - 1]);
    const hasOpenEndedWindow = resolvedWindows.some((window) =>
      !window.end && !issues.some((issue) => issue.type === "invalid-date" && issue.windowId === window.id)
    );
    const activeAfterFinalEvent = resolvedWindows.some((window) =>
      finalDate >= window.start && (!window.end || finalDate < addMonths(window.end, 1))
    );
    if (!hasOpenEndedWindow && !activeAfterFinalEvent) {
      issues.push({ type: "gap", startDate: finalDate });
    }
  }

  // Consolidate continuous issues
  const consolidatedIssues: TimelineIssue[] = [];
  issues.forEach(issue => {
    if (issue.type === "invalid-date") {
      consolidatedIssues.push(issue);
      return;
    }
    const last = consolidatedIssues[consolidatedIssues.length - 1];
    if (last && last.type === issue.type && last.type !== ("invalid-date" as any)) {
      if (
        last.endDate
        && addMonths(last.endDate, 1).getTime() === issue.startDate.getTime()
        && (last as any).amount === (issue as any).amount
      ) {
        last.endDate = issue.endDate;
        return;
      }
    }
    consolidatedIssues.push(issue);
  });
  
  return { timeline, issues: consolidatedIssues };
}
