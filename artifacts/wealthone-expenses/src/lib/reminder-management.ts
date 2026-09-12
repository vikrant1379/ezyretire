import type { FinancialReminder } from "./storage.ts";

export type ReminderLifecycle = "disabled" | "due-today" | "overdue" | "upcoming" | "recurring";

export function reminderLifecycle(reminder: FinancialReminder, today: string): ReminderLifecycle {
  if (!reminder.enabled) return "disabled";
  if (reminder.date === today) return "due-today";
  if (reminder.recurrence !== "none") return "recurring";
  return reminder.date < today ? "overdue" : "upcoming";
}

export function managedReminderRows(reminders: FinancialReminder[], today: string) {
  return reminders
    .map((reminder) => ({ reminder, lifecycle: reminderLifecycle(reminder, today) }))
    .sort((left, right) =>
      left.reminder.date.localeCompare(right.reminder.date)
        || left.reminder.id.localeCompare(right.reminder.id));
}