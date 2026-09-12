import { useMemo, useState } from "react";
import { type FinancialData } from "@/lib/financial-api";
import { generateFinancialCalendar, calendarViews, dateInTimeZone, type FinancialCalendarEvent } from "@/lib/financial-calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { ChevronLeft, ChevronRight, Edit2, Plus, Trash2 } from "lucide-react";
import { ReminderFormDialog } from "./reminder-form-dialog";
import { useFinancialWrite } from "@/hooks/use-financial-write";
import { calculateTargetRetirementMonth, formatDateOnly, type FinancialReminder } from "@/lib/storage";
import { managedReminderRows } from "@/lib/reminder-management";

function calendarAmountClass(kind: FinancialCalendarEvent["kind"], amount: number) {
  if (amount === 0) return "text-foreground";
  if (amount < 0) return "text-negative";
  if (kind === "income" || kind === "investment" || kind === "investment-maturity") return "text-positive";
  return "text-foreground";
}

export function CalendarView({ data }: { data: FinancialData }) {
  const write = useFinancialWrite();
  const [now] = useState(new Date());
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<FinancialReminder | undefined>();
  const [deletingReminderId, setDeletingReminderId] = useState<string | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  
  const historicalStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const generatedStart = visibleMonth < historicalStart ? visibleMonth : historicalStart;
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const visibleEnd = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0);
  const generatedEnd = visibleEnd > defaultEnd ? visibleEnd : defaultEnd;
  const from = dateInTimeZone(generatedStart, timeZone);
  const through = dateInTimeZone(generatedEnd, timeZone);
  const retirementMonth = calculateTargetRetirementMonth({
    dateOfBirth: data.profileInputs.dateOfBirth,
    targetRetirementAge: data.retirementInputs.targetRetirementAge,
  });
  
  const events = generateFinancialCalendar({
    from,
    through,
    asOf: now,
    incomes: data.incomeSources,
    investments: data.investments,
    loans: data.loans,
    budgets: data.budgets,
    plannedExpenses: data.plannedExpenses,
    reminders: data.reminders,
    ...(retirementMonth ? { retirementDate: formatDateOnly(retirementMonth) } : {}),
  });

  const views = calendarViews(events, now, timeZone, 30);
  const managedReminders = managedReminderRows(data.reminders, dateInTimeZone(now, timeZone));

  const handleDeleteReminder = async (sourceId: string, title: string) => {
    if (deletingReminderId) return;
    if (!window.confirm(`Delete “${title}”? This removes every future occurrence.`)) return;
    setDeletingReminderId(sourceId);
    try {
      await write(current => ({
        ...current,
        reminders: current.reminders.filter(r => r.id !== sourceId)
      }));
    } catch {
      // The shared write handler explains the failure and leaves the reminder available to retry.
    } finally {
      setDeletingReminderId(null);
    }
  };

  const lastDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const leadingBlanks = visibleMonth.getDay();
  const visibleMonthKey = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`;
  const eventsByDay = useMemo(() => events.filter((event) => event.date.startsWith(visibleMonthKey)).reduce<Record<number, FinancialCalendarEvent[]>>((byDay, event) => {
    const day = Number(event.date.slice(8, 10));
    (byDay[day] ??= []).push(event);
    return byDay;
  }, {}), [events, visibleMonthKey]);
  const weeks = Array.from({ length: Math.ceil((leadingBlanks + lastDay) / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const day = week * 7 + weekday - leadingBlanks + 1;
      return day > 0 && day <= lastDay ? day : undefined;
    }));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <ReminderFormDialog isOpen={isAddOpen} setIsOpen={setIsAddOpen}>
          <Button
            variant="outline"
            className="border-primary/40 bg-primary/10 text-primary shadow-sm hover:border-primary/50 hover:bg-primary/20 dark:border-primary/35 dark:bg-primary/15 dark:text-foreground dark:hover:bg-primary/25"
            onClick={() => setIsAddOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Reminder
          </Button>
        </ReminderFormDialog>
      </div>

      <ReminderFormDialog
        reminder={editingReminder}
        isOpen={Boolean(editingReminder)}
        setIsOpen={(open) => { if (!open) setEditingReminder(undefined); }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Custom reminders</CardTitle>
          <CardDescription>Edit, enable, or remove reminders in every lifecycle state.</CardDescription>
        </CardHeader>
        <CardContent>
          {managedReminders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom reminders yet.</p>
          ) : (
            <ul className="divide-y">
              {managedReminders.map(({ reminder, lifecycle }) => (
                <li className="flex items-center justify-between gap-3 py-3" key={reminder.id}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{reminder.title}</p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {reminder.date} · {reminder.recurrence === "none" ? "one-time" : reminder.recurrence} · {lifecycle.replace("-", " ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setEditingReminder(reminder)} aria-label={`Edit ${reminder.title}`}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={Boolean(deletingReminderId)} className="text-muted-foreground hover:text-foreground" onClick={() => handleDeleteReminder(reminder.id, reminder.title)} aria-label={`Delete ${reminder.title}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="min-w-0 overflow-hidden md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
              <CardTitle>{visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</CardTitle>
              <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <CardDescription>{events.filter((event) => event.date.startsWith(visibleMonthKey)).length} scheduled financial events this month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="w-full min-w-0" role="grid" aria-label="Financial calendar month view">
              <div className="grid grid-cols-7 border-b text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground" role="row">
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day) => (
                  <div className="min-w-0 px-0.5 py-2 sm:p-2" role="columnheader" key={day}>{day.slice(0, 3)}</div>
                ))}
              </div>
              <div role="rowgroup">
                {weeks.map((week, weekIndex) => <div className="grid grid-cols-7" role="row" key={`week-${weekIndex}`}>
                {week.map((day, weekday) => {
                  if (!day) return <div className="min-h-16 min-w-0 border-b border-r bg-muted/20 sm:min-h-24" role="gridcell" aria-label="No date" key={`blank-${weekday}`} />;
                  const dayEvents = eventsByDay[day] ?? [];
                  const isToday = day === now.getDate() && visibleMonthKey === dateInTimeZone(now, timeZone).slice(0, 7);
                  return (
                    <div
                       className="min-h-16 min-w-0 overflow-hidden border-b border-r p-1 sm:min-h-24 sm:p-2"
                      role="gridcell"
                       aria-label={`${day} ${visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}: ${dayEvents.length} events`}
                      key={day}
                    >
                      <span className={isToday ? "inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground" : "text-sm font-medium"}>
                        {day}
                      </span>
                      <ul className="mt-1 space-y-1">
                        {dayEvents.slice(0, 3).map((event) => (
                          <li className="truncate rounded bg-primary/10 px-1.5 py-0.5 text-xs text-foreground" title={event.title} key={event.id}>
                            {event.title}
                          </li>
                        ))}
                        {dayEvents.length > 3 && <li className="text-xs text-muted-foreground">+{dayEvents.length - 3} more</li>}
                      </ul>
                    </div>
                  );
                })}</div>)}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <CardDescription>{views.today.length} events today</CardDescription>
          </CardHeader>
          <CardContent>
            {views.today.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing scheduled for today.</p>
            ) : (
              <ul className="space-y-2">
                {views.today.map(e => (
                  <li key={e.id} className="flex justify-between text-sm">
                    <span>{e.title}</span>
                    {e.amount !== undefined && <span className={calendarAmountClass(e.kind, e.amount)}>{e.amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Overdue</CardTitle>
            <CardDescription>{views.overdue.length} events overdue</CardDescription>
          </CardHeader>
          <CardContent>
            {views.overdue.length === 0 ? (
              <p className="text-muted-foreground text-sm">No overdue events.</p>
            ) : (
              <ul className="space-y-2">
                {views.overdue.map(e => (
                  <li key={e.id} className="flex justify-between text-sm">
                    <span>{e.title} <span className="opacity-70">({e.date})</span></span>
                    {e.amount !== undefined && <span className={calendarAmountClass(e.kind, e.amount)}>{e.amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Upcoming (Next 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {views.upcoming.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing upcoming.</p>
            ) : (
              <ul className="space-y-2 divide-y">
                {views.upcoming.map(e => (
                  <li key={e.id} className="flex justify-between items-center text-sm py-2">
                    <div>
                      <div className="font-medium">{e.title}</div>
                      <div className="text-xs text-muted-foreground capitalize">{e.kind} &bull; {e.date}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      {e.amount !== undefined && <div className={`font-medium ${calendarAmountClass(e.kind, e.amount)}`}>{e.amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
