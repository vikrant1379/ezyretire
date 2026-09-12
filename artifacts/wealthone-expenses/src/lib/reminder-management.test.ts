import assert from "node:assert/strict";
import test from "node:test";
import { managedReminderRows } from "./reminder-management.ts";
import type { FinancialReminder } from "./storage.ts";

const reminder = (id: string, date: string, enabled = true, recurrence: FinancialReminder["recurrence"] = "none"): FinancialReminder => ({
  id, title: id, date, enabled, recurrence, createdAt: "2025-03-01T00:00:00.000Z",
});

test("management rows retain disabled, due, overdue, recurring, and future reminders", () => {
  const rows = managedReminderRows([
    reminder("disabled", "2025-03-01", false),
    reminder("today", "2025-03-10"),
    reminder("overdue", "2025-03-09"),
    reminder("recurring", "2025-01-01", true, "monthly"),
    reminder("future", "2025-03-11"),
  ], "2025-03-10");
  assert.deepEqual(
    Object.fromEntries(rows.map(({ reminder, lifecycle }) => [reminder.id, lifecycle])),
    {
      recurring: "recurring",
      disabled: "disabled",
      overdue: "overdue",
      today: "due-today",
      future: "upcoming",
    },
  );
});