import { useState } from "react";
import { format } from "date-fns";
import { CalendarClock, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { PLANNED_EXPENSE_CATEGORY_INFLATION, plannedExpenseInflatedValue, type PlannedExpense } from "@/lib/storage";
import { formatINR } from "@/lib/utils";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { DownloadExcelButton } from "@/components/download-excel-button";
import { buildPlannedExpenseReportSheets } from "@/lib/excel-report-builders";
import { usePlannedExpenses, useUpdatePlannedExpense, useUpdatePlannedExpenses } from "@/hooks/use-planned-expenses";

const categories = Object.keys(PLANNED_EXPENSE_CATEGORY_INFLATION);
const emptyDraft = { name: "", category: "Other", amount: "", expectedDate: "", inflation: "" };

export function PlannedExpenses() {
  const { data: expenses = [] } = usePlannedExpenses();
  const save = useUpdatePlannedExpenses();
  const update = useUpdatePlannedExpense();
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const sorted = [...expenses].sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  const submit = () => {
    const amount = Number(draft.amount);
    const inflation = draft.inflation === "" ? undefined : Number(draft.inflation);
    if (
      !draft.name.trim()
      || !draft.expectedDate
      || !Number.isFinite(amount)
      || amount <= 0
      || (inflation !== undefined && (!Number.isFinite(inflation) || inflation < 0 || inflation > 25))
    ) return;
    const existing = editingId ? expenses.find((expense) => expense.id === editingId) : undefined;
    const expense: PlannedExpense = {
      id: existing?.id ?? crypto.randomUUID(),
      name: draft.name.trim(),
      category: draft.category,
      amount,
      expectedDate: draft.expectedDate,
      ...(inflation !== undefined ? { customInflationRate: inflation } : {}),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const onSuccess = () => {
      setDraft(emptyDraft);
      setEditingId(null);
    };
    if (existing) {
      update.mutate(expense, { onSuccess });
      return;
    }
    save.mutate({ type: "append", expenses: [expense] }, { onSuccess });
  };
  const edit = (expense: PlannedExpense) => {
    setEditingId(expense.id);
    setDraft({
      name: expense.name,
      category: expense.category,
      amount: String(expense.amount),
      expectedDate: expense.expectedDate,
      inflation: expense.customInflationRate === undefined ? "" : String(expense.customInflationRate),
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft(emptyDraft);
  };
  const isSaving = save.isPending || update.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif"><CalendarClock className="h-5 w-5" /> Planned future expenses</CardTitle>
        <CardDescription>Schedule a goal or major cost. Its inflation-adjusted value is included in retirement shortfall calculations.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <div><Label htmlFor="planned-name">Expense</Label><Input id="planned-name" data-testid="input-planned-expense-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Home renovation" /></div>
          <div><Label id="planned-category-label">Category</Label><Select value={draft.category} onValueChange={(category) => setDraft({ ...draft, category })}><SelectTrigger aria-labelledby="planned-category-label" data-testid="select-planned-expense-category"><SelectValue /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div>
          <div><Label htmlFor="planned-amount">Today&apos;s value</Label><Input id="planned-amount" data-testid="input-planned-expense-amount" type="number" min="0" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></div>
          <div><Label htmlFor="planned-date">Expected date</Label><Input id="planned-date" data-testid="input-planned-expense-date" type="date" value={draft.expectedDate} onChange={(e) => setDraft({ ...draft, expectedDate: e.target.value })} /></div>
          <div><Label htmlFor="planned-inflation">Inflation % (optional)</Label><Input id="planned-inflation" data-testid="input-planned-expense-inflation" type="number" min="0" max="25" step="0.1" value={draft.inflation} onChange={(e) => setDraft({ ...draft, inflation: e.target.value })} placeholder={`${PLANNED_EXPENSE_CATEGORY_INFLATION[draft.category] ?? 6}% default`} /></div>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            <Button type="button" data-testid="button-save-planned-expense" onClick={submit} disabled={isSaving}>
              {editingId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
              {editingId ? "Save changes" : "Add planned expense"}
            </Button>
            {editingId && <Button type="button" data-testid="button-cancel-planned-expense-edit" variant="outline" onClick={cancelEdit} disabled={isSaving}><X className="mr-2 h-4 w-4" />Cancel</Button>}
          </div>
          {expenses.length > 0 && (
            <DownloadExcelButton
              sheets={buildPlannedExpenseReportSheets(sorted)}
              reportSlug="planned_future_expenses_report"
              size="sm"
              mobileDirectDownload
            />
          )}
        </div>
        {sorted.length > 0 && (
          <ol className="space-y-2 border-l-2 border-primary/20 pl-4" aria-label="Planned expense timeline">
            {sorted.map((expense) => (
              <li key={expense.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
                <div><p className="font-medium" data-testid={`text-planned-expense-name-${expense.id}`}>{expense.name}</p><p className="text-xs text-muted-foreground">{format(new Date(`${expense.expectedDate}T00:00:00`), "MMM yyyy")} · {expense.category} · {expense.customInflationRate ?? PLANNED_EXPENSE_CATEGORY_INFLATION[expense.category] ?? 6}% inflation</p></div>
                <div className="text-right"><p className="font-semibold" data-testid={`text-planned-expense-value-${expense.id}`}>{formatINR(plannedExpenseInflatedValue(expense))}</p><p className="text-xs text-muted-foreground">inflated value</p></div>
                <div className="flex">
                  <Button variant="ghost" size="icon" data-testid={`button-edit-planned-expense-${expense.id}`} aria-label={`Edit ${expense.name}`} onClick={() => edit(expense)} disabled={isSaving}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" data-testid={`button-delete-planned-expense-${expense.id}`} aria-label={`Delete ${expense.name}`} disabled={isSaving} onClick={() => save.mutate({ type: "remove", id: expense.id }, { onSuccess: () => editingId === expense.id && cancelEdit() })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
