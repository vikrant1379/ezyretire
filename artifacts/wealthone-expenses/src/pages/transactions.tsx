import { useState, useMemo } from "react";
import { endOfMonth, format, isWithinInterval, startOfMonth } from "date-fns";
import { useExpenses, useDeleteExpense } from "@/hooks/use-expenses";
import { useBudgets } from "@/hooks/use-budgets";
import { useRetirementInputs } from "@/hooks/use-retirement";
import { useLoans } from "@/hooks/use-loans";
import { formatINR } from "@/lib/utils";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Badge } from "@workspace/wealthone-design-system/components/ui/badge";
import { EditExpenseDialog } from "@/components/edit-expense-dialog";
import { DataManager } from "@/components/data-manager";
import { QuickAddExpense } from "@/components/quick-add-expense";
import { ExpenseModeSwitch } from "@/components/expense-mode-switch";
import { budgetTotalForMonth, getLinkedLoanName, type Expense } from "@/lib/storage";
import { getTargetRetirementMonth } from "@/lib/budget-helpers";
import { Search, Pencil, Trash2, SlidersHorizontal, AlertCircle, Target, MoreVertical } from "lucide-react";
import { Progress } from "@workspace/wealthone-design-system/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/wealthone-design-system/components/ui/select";
import { useAllCategories } from "@/lib/categories";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/wealthone-design-system/components/ui/alert-dialog";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/wealthone-design-system/components/ui/dropdown-menu";
import { CardSortControls } from "@/components/card-sort-controls";
import type { SortDirection } from "@/lib/card-order";

type TransactionSortBy = "date" | "amount" | "merchant" | "category";
const TransactionSortControls = CardSortControls<TransactionSortBy>;

export default function Transactions() {
  const { data: expenses = [], isLoading } = useExpenses();
  const { data: budgets = [], isLoading: budgetsLoading } = useBudgets();
  const { data: retirementInputs } = useRetirementInputs();
  const { data: loans = [], isLoading: loansLoading } = useLoans();
  const deleteExpense = useDeleteExpense();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [paymentTypeFilter, setPaymentTypeFilter] = useState("all");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState<TransactionSortBy>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const categories = useAllCategories();
  const monthStart = startOfMonth(new Date());
  const monthEnd = endOfMonth(new Date());
  const totalBudget = budgetTotalForMonth(
    budgets,
    monthStart,
    retirementInputs?.generalInflation ?? 0,
    monthStart,
    getTargetRetirementMonth(retirementInputs),
  );
  const totalSpent = expenses
    .filter((expense) =>
      !expense.reimbursable
      && isWithinInterval(new Date(expense.date), { start: monthStart, end: monthEnd })
    )
    .reduce((sum, expense) => sum + expense.amount, 0);
  const budgetRemaining = Math.max(totalBudget - totalSpent, 0);
  const budgetUsed = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;
  const activeFilterCount =
    Number(categoryFilter !== "all") + Number(paymentTypeFilter !== "all");

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      const linkedLoanName = getLinkedLoanName(e, loans);
      const matchesSearch = 
        e.merchant.toLowerCase().includes(search.toLowerCase()) || 
        e.category.toLowerCase().includes(search.toLowerCase()) ||
        (e.note && e.note.toLowerCase().includes(search.toLowerCase())) ||
        linkedLoanName.toLowerCase().includes(search.toLowerCase());
      
      const matchesCategory = categoryFilter === "all" || e.category === categoryFilter;
      const matchesPaymentType =
        paymentTypeFilter === "all"
        || (paymentTypeFilter === "tracked-loan" && Boolean(e.linkedLoanId))
        || (paymentTypeFilter === "ordinary" && !e.linkedLoanId);

      return matchesSearch && matchesCategory && matchesPaymentType;
    });
  }, [expenses, loans, search, categoryFilter, paymentTypeFilter]);

  const sortedExpenses = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filteredExpenses].sort((left, right) => {
      if (sortBy === "date") {
        return (new Date(left.date).getTime() - new Date(right.date).getTime()) * direction;
      }
      if (sortBy === "amount") {
        return (left.amount - right.amount) * direction;
      }
      const leftValue = sortBy === "merchant" ? left.merchant : left.category;
      const rightValue = sortBy === "merchant" ? right.merchant : right.category;
      return leftValue.localeCompare(rightValue, undefined, { sensitivity: "base" }) * direction;
    });
  }, [filteredExpenses, sortBy, sortDirection]);

  const handleDelete = (id: string) => {
    deleteExpense.mutate(id, {
      onSuccess: () => {
        toast({
          title: "Expense deleted",
          description: "The transaction has been removed.",
        });
      }
    });
  };

  if (isLoading || loansLoading || budgetsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-primary/20 rounded-full mb-4"></div>
          <p className="text-muted-foreground">Loading your expenses...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-500 pb-10 sm:space-y-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-4 md:flex md:items-end md:justify-between">
        <div className="min-w-0 md:mr-auto">
          <h1 className="text-3xl font-serif text-primary">Expenses</h1>
          <p className="mt-1 max-w-xl text-sm leading-5 text-muted-foreground">
            Track daily spending and keep your monthly plan in view.
          </p>
        </div>
        <div className="md:order-3">
          <DataManager loans={loans} expenses={sortedExpenses} />
        </div>
        <div className="col-span-2 md:order-2">
          <QuickAddExpense className="h-11 w-full text-base md:h-10 md:w-auto md:text-sm" />
        </div>
      </div>

      <ExpenseModeSwitch />

      <section className="rounded-xl bg-primary p-5 text-primary-foreground shadow-md md:p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
              <Target className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-primary-foreground/75">
                This month
              </p>
              <p className="text-2xl font-bold">
                {totalSpent > 0 ? formatINR(totalSpent) : "No spending yet"}
              </p>
              <p className="text-xs text-primary-foreground/75">spent so far</p>
            </div>
          </div>

          <div className="w-full space-y-3 md:max-w-md">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-primary-foreground/70">Monthly budget</p>
                <p className="font-semibold">{totalBudget > 0 ? formatINR(totalBudget) : "Not set"}</p>
              </div>
              <div className="text-right">
                <p className="text-primary-foreground/70">Remaining</p>
                <p className="font-semibold">{totalBudget > 0 ? formatINR(budgetRemaining) : "—"}</p>
              </div>
            </div>
            {totalBudget > 0 && (
              <Progress
                value={budgetUsed}
                aria-label={`${Math.round(budgetUsed)}% of monthly budget used`}
                className="h-2 bg-primary-foreground/20 [&>div]:bg-primary-foreground"
              />
            )}
          </div>
        </div>
      </section>

      <div className="rounded-xl border border-border bg-card p-2.5 shadow-sm sm:p-4 md:flex md:items-center md:gap-2">
        <div className="flex min-w-0 gap-2 md:flex-1">
          <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search merchant, category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
              className="w-full border-0 bg-background/50 pl-9 shadow-none focus-visible:ring-1"
          />
          </div>
          <Button
            type="button"
            variant={activeFilterCount > 0 ? "secondary" : "outline"}
            className="shrink-0 gap-2 px-3 sm:hidden"
            onClick={() => setMobileFiltersOpen((open) => !open)}
            aria-expanded={mobileFiltersOpen}
            aria-controls="mobile-expense-filters"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden min-[390px]:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>

        <div
          id="mobile-expense-filters"
          className={`${mobileFiltersOpen ? "grid" : "hidden"} mt-2 grid-cols-1 gap-2 sm:mt-3 sm:flex sm:items-center md:mt-0 md:shrink-0`}
        >
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground hidden sm:block shrink-0" />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full border-0 bg-background/50 shadow-none focus:ring-1 sm:w-[180px] md:w-[150px] lg:w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={paymentTypeFilter} onValueChange={setPaymentTypeFilter}>
            <SelectTrigger className="w-full border-0 bg-background/50 shadow-none focus:ring-1 sm:w-[190px] md:w-[170px] lg:w-[190px]">
              <SelectValue placeholder="Payment type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Payments</SelectItem>
              <SelectItem value="tracked-loan">Tracked Loan Payments</SelectItem>
              <SelectItem value="ordinary">Ordinary Expenses</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="min-w-0 text-base font-semibold text-foreground sm:text-lg">
          Transactions
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            ({sortedExpenses.length})
          </span>
        </h2>
        {sortedExpenses.length > 1 && (
          <TransactionSortControls
            value={sortBy}
            direction={sortDirection}
            options={
              [
                { value: "date", label: "Date" },
                { value: "amount", label: "Amount" },
                { value: "merchant", label: "Merchant" },
                { value: "category", label: "Category" },
              ] satisfies { value: TransactionSortBy; label: string }[]
            }
            onByChange={setSortBy}
            onDirectionChange={setSortDirection}
            compactOnMobile
            className="shrink-0"
          />
        )}
      </div>

      {sortedExpenses.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="hidden md:grid grid-cols-12 gap-4 p-4 text-sm font-medium text-muted-foreground border-b border-border bg-muted/20">
            <div className="col-span-2">Date</div>
            <div className="col-span-4">Details</div>
            <div className="col-span-2">Category</div>
            <div className="col-span-2 text-right">Amount</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          
          <div className="divide-y divide-border">
            {sortedExpenses.map((expense) => (
              <div key={expense.id} className="transition-colors hover:bg-muted/10">
                <div className="p-3.5 md:hidden">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="truncate font-semibold text-foreground">{expense.merchant}</p>
                        <p className="shrink-0 font-sans text-base font-bold text-foreground">
                          {formatINR(expense.amount)}
                        </p>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                        <span>{format(new Date(expense.date), "dd MMM yyyy")}</span>
                        <span aria-hidden="true">•</span>
                        <span className="font-medium text-foreground/80">{expense.category}</span>
                        <span aria-hidden="true">•</span>
                        <span>{expense.paymentMethod}</span>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="-mr-2 -mt-2 h-9 w-9 shrink-0 text-muted-foreground"
                          aria-label={`More actions for ${expense.merchant}`}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onSelect={() => setEditingExpense(expense)}>
                          <Pencil className="h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setDeletingExpense(expense)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {(expense.note || expense.reimbursable || expense.linkedLoanId) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {expense.note && <span className="line-clamp-1">{expense.note}</span>}
                      {expense.linkedLoanId && (
                        <Badge variant="secondary" className="h-5 max-w-full truncate px-1.5 text-[10px]">
                          Loan EMI · {getLinkedLoanName(expense, loans)}
                        </Badge>
                      )}
                      {expense.reimbursable && (
                        <span className="rounded bg-secondary/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-secondary-foreground">
                          Reimbursable
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="hidden grid-cols-12 items-center gap-4 p-4 md:grid">
                  <div className="col-span-2 text-sm">
                    {format(new Date(expense.date), "dd MMM, yyyy")}
                  </div>
                  <div className="col-span-4 flex min-w-0 flex-col">
                    <span className="break-words font-medium">{expense.merchant}</span>
                    {(expense.note || expense.reimbursable || expense.linkedLoanId) && (
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="max-w-full break-words">{expense.note}</span>
                        {expense.linkedLoanId && (
                          <Badge variant="secondary" className="max-w-full truncate">
                            Loan EMI · {getLinkedLoanName(expense, loans)}
                          </Badge>
                        )}
                        {expense.reimbursable && (
                          <span className="rounded bg-secondary/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-secondary-foreground">
                            Reimbursable
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 flex flex-col">
                    <span className="text-sm">{expense.category}</span>
                    <span className="text-xs text-muted-foreground">{expense.paymentMethod}</span>
                  </div>
                  <div className="col-span-2 text-right font-sans font-semibold">
                    {formatINR(expense.amount)}
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-2">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    onClick={() => setEditingExpense(expense)}
                    aria-label={`Edit ${expense.merchant} transaction`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${expense.merchant} transaction`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete this expense record. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => handleDelete(expense.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-12 bg-card rounded-xl border border-dashed border-border text-center">
          <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <AlertCircle className="h-8 w-8 text-muted-foreground opacity-50" />
          </div>
          <h3 className="text-lg font-serif mb-2">No transactions found</h3>
          <p className="text-muted-foreground max-w-sm text-sm">
            {search || categoryFilter !== "all" || paymentTypeFilter !== "all"
              ? "We couldn't find any expenses matching your filters. Try adjusting your search criteria."
              : "Your ledger is empty. Add your first expense to get started or import data."}
          </p>
        </div>
      )}

      <EditExpenseDialog 
        expense={editingExpense} 
        open={!!editingExpense} 
        onOpenChange={(open) => {
          if (!open) setEditingExpense(null);
        }} 
      />

      <AlertDialog
        open={!!deletingExpense}
        onOpenChange={(open) => {
          if (!open) setDeletingExpense(null);
        }}
      >
        <AlertDialogContent className="bottom-0 left-0 top-auto w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-t-[28px] border-x-0 border-b-0 p-0 sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:max-w-md sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-xl sm:border">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border sm:hidden" />
          <AlertDialogHeader className="items-center px-5 pb-4 pt-5 text-center sm:items-start sm:px-6 sm:pt-6 sm:text-left">
            <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive sm:h-10 sm:w-10">
              <Trash2 className="h-5 w-5" />
            </div>
            <AlertDialogTitle className="text-xl">Delete transaction?</AlertDialogTitle>
            <AlertDialogDescription className="max-w-sm leading-relaxed">
              This transaction will be permanently removed and cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deletingExpense && (
            <div className="mx-5 mb-5 flex items-center justify-between gap-4 rounded-xl bg-muted/60 px-4 py-3 sm:mx-6">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {deletingExpense.merchant}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {format(new Date(deletingExpense.date), "dd MMM yyyy")} · {deletingExpense.category}
                </p>
              </div>
              <p className="shrink-0 font-sans font-bold text-foreground">
                {formatINR(deletingExpense.amount)}
              </p>
            </div>
          )}

          <AlertDialogFooter className="grid grid-cols-2 gap-3 border-t border-border bg-muted/20 p-4 sm:flex sm:px-6 sm:py-4">
            <AlertDialogCancel className="mt-0 h-11 rounded-xl sm:h-10 sm:rounded-md">
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingExpense) handleDelete(deletingExpense.id);
                setDeletingExpense(null);
              }}
              className="h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:h-10 sm:rounded-md"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
