import { useState, useMemo } from "react";
import { format, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { useExpenses } from "@/hooks/use-expenses";
import { useRetirementInputs } from "@/hooks/use-retirement";
import { formatINR } from "@/lib/utils";
import {
  budgetTotalForMonth,
  isBudgetWindowActive,
  parseDateOnly,
  validateBudgetSchedule,
  type Budget,
} from "@/lib/storage";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@workspace/wealthone-design-system/components/ui/card";
import { Progress } from "@workspace/wealthone-design-system/components/ui/progress";
import {
  CORE_CATEGORIES,
  isCustomPlanningCategory,
  OPTIONAL_CATEGORIES,
  useBudgetCategories,
} from "@/lib/categories";
import { getBudgetCategoryType, getBudgetPlanDimensions } from "@/lib/budget-analytics";
import { trackEvent } from "@/lib/analytics";
import { CATEGORY_ICON_TONE, getCategoryIcon } from "@/lib/category-visuals";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { BudgetEditor } from "@/components/budget-editor";
import { ExpenseModeSwitch } from "@/components/expense-mode-switch";
import { type UIBudgetWindow } from "@/lib/budget-helpers";
import { getTargetRetirementMonth } from "@/lib/budget-helpers";
import { Switch } from "@workspace/wealthone-design-system/components/ui/switch";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/wealthone-design-system/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/wealthone-design-system/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/wealthone-design-system/components/ui/dropdown-menu";
import { useBudgets, useManageBudgetCategory, useUpdateBudget } from "@/hooks/use-budgets";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialData } from "@/lib/financial-api";
import { FINANCIAL_DATA_KEY } from "@/hooks/use-financial-write";
import { Target, Pencil, Check, X, Plus, MoreHorizontal, MoreVertical, Archive, ArchiveRestore } from "lucide-react";
import { CardSortControls } from "@/components/card-sort-controls";
import type { SortDirection } from "@/lib/card-order";

type BudgetSortBy = "category" | "limit" | "spent" | "remaining" | "usage";
const BudgetCardSortControls = CardSortControls<BudgetSortBy>;

export default function Budgets() {
  const { data: budgets = [], isLoading: loadingBudgets } = useBudgets();
  const { data: expenses = [], isLoading: loadingExpenses } = useExpenses();
  const { data: retirementInputs } = useRetirementInputs();
  const updateBudget = useUpdateBudget();
  const manageCategory = useManageBudgetCategory();
  const { toast } = useToast();

  const [editingCategory, setEditingCategory] = useState<string | null>(null);

  // For the simple 1-amount view
  const [editAmount, setEditAmount] = useState<string>("");

  // For the advanced windows view
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [editWindows, setEditWindows] = useState<UIBudgetWindow[]>([]);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [categoryChoice, setCategoryChoice] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [manageCategoryName, setManageCategoryName] = useState<string | null>(null);
  const [renamedCategory, setRenamedCategory] = useState("");
  const [archivedCategoriesOpen, setArchivedCategoriesOpen] = useState(false);
  const [sortBy, setSortBy] = useState<BudgetSortBy>("limit");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const { data: financialData } = useQuery({
    queryKey: FINANCIAL_DATA_KEY,
    queryFn: fetchFinancialData,
  });

  const monthStart = startOfMonth(new Date());
  const monthEnd = endOfMonth(new Date());

  const categories = useBudgetCategories();
  const archivedCategories = (financialData?.uiPreferences.archivedPlanningCategories ?? [])
    .filter(isCustomPlanningCategory)
    .map((category) => ({
      category,
      budget: budgets.find((budget) => budget.category === category),
    }));
  const retirementDate = getTargetRetirementMonth(retirementInputs);
  const currentInflation = retirementInputs?.generalInflation ?? 0;

  const categoryData = useMemo(() => {
    const currentMonthExpenses = expenses.filter(e => 
      isWithinInterval(new Date(e.date), { start: monthStart, end: monthEnd }) && !e.reimbursable
    );

    return categories.map(category => {
      const budget = budgets.find(b => b.category === category);

      const currentLimit = budget
        ? budgetTotalForMonth(
            [budget],
            monthStart,
            currentInflation,
            monthStart,
            retirementDate,
          )
        : 0;
      const activeWindows = budget?.windows?.filter((window) =>
        isBudgetWindowActive(window, monthStart, retirementDate)
      ) ?? [];
      const upcomingWindow = budget?.windows
        ?.filter((window) => window.startDate && parseDateOnly(window.startDate) > monthEnd)
        .sort((left, right) => String(left.startDate).localeCompare(String(right.startDate)))[0];
      
      const spent = currentMonthExpenses
        .filter(e => e.category === category)
        .reduce((sum, e) => sum + e.amount, 0);

      const percentUsed = currentLimit > 0 ? (spent / currentLimit) * 100 : (spent > 0 ? 100 : 0);
      const remaining = Math.max(currentLimit - spent, 0);
      const overBudget = spent > currentLimit;

      return {
        category,
        Icon: getCategoryIcon(category),
        limit: currentLimit,
        rawBudget: budget,
        spent,
        percentUsed,
        remaining,
        overBudget,
        hasBudget: currentLimit > 0,
        hasPlan: Boolean(budget?.windows?.some((window) => window.monthlyLimit > 0)),
        activeWindows,
        upcomingWindow,
      };
    }).sort((a, b) => b.limit - a.limit);
  }, [
    budgets,
    categories,
    currentInflation,
    expenses,
    monthEnd,
    monthStart,
    retirementDate,
  ]);

  const sortedCategoryData = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...categoryData].sort((left, right) => {
      if (sortBy === "category") {
        return left.category.localeCompare(right.category, undefined, { sensitivity: "base" }) * direction;
      }
      const values = {
        limit: [left.limit, right.limit],
        spent: [left.spent, right.spent],
        remaining: [left.remaining, right.remaining],
        usage: [left.percentUsed, right.percentUsed],
      } as const;
      const [leftValue, rightValue] = values[sortBy];
      return (leftValue - rightValue) * direction;
    });
  }, [categoryData, sortBy, sortDirection]);

  const handleEdit = (category: string, data: any) => {
    setEditingCategory(category);

    // Check if it has complex windows
    const rawWindows = data.rawBudget?.windows || [];
    if (rawWindows.length > 1 || (rawWindows.length === 1 && (rawWindows[0].startDate || rawWindows[0].endMode !== "lifelong"))) {
      setShowAdvanced(true);
      setEditWindows(rawWindows.map((w: any) => ({
        id: w.id,
        monthlyLimit: w.monthlyLimit,
        startDate: w.startDate,
        endMode: w.endMode,
        endDate: w.endDate,
        note: w.note
      })));
    } else {
      setShowAdvanced(false);
      setEditAmount(data.limit > 0 ? data.limit.toString() : "");
      setEditWindows(rawWindows.length === 1 ? [rawWindows[0]] : []);
    }
  };

  const handleSave = (category: string) => {
    let payloadWindows: any[] = [];
    let payloadLimit = 0;

    if (showAdvanced) {
      // Clean up empty windows
      payloadWindows = editWindows.filter(w => w.monthlyLimit > 0 || w.startDate || w.endMode !== "lifelong").map(w => ({
        id: w.id || crypto.randomUUID(),
        monthlyLimit: Number(w.monthlyLimit) || 0,
        startDate: w.startDate,
        endMode: w.endMode,
        endDate: w.endDate,
        note: w.note
      }));
      if (payloadWindows.some((window) => window.endMode === "retirement") && !retirementDate) {
        toast({
          title: "Set your retirement date",
          description: "A retirement-ended budget needs a valid date of birth and retirement age.",
          variant: "destructive",
        });
        return;
      }
      const candidate: Budget = { category, monthlyLimit: 0, windows: payloadWindows };
      const validationErrors = validateBudgetSchedule([candidate]);
      if (validationErrors.length > 0) {
        toast({
          title: "Check this plan",
          description: validationErrors[0],
          variant: "destructive",
        });
        return;
      }
      payloadLimit = budgetTotalForMonth(
        [candidate],
        monthStart,
        0,
        monthStart,
        retirementDate,
      );
    } else {
      const limit = Number(editAmount);
      if (isNaN(limit) || limit < 0) return;

      payloadLimit = limit;
      payloadWindows = [{
        id: editWindows[0]?.id || crypto.randomUUID(),
        monthlyLimit: limit,
        endMode: "lifelong"
      }];
    }

    updateBudget.mutate(
      { category, monthlyLimit: payloadLimit, windows: payloadWindows },
      {
        onSuccess: () => {
          trackEvent("budget_plan_saved", getBudgetPlanDimensions(
            getBudgetCategoryType(category, CORE_CATEGORIES, OPTIONAL_CATEGORIES),
            payloadWindows,
            retirementDate,
          ));
          setEditingCategory(null);
          toast({
            title: "Budget updated",
            description: `Limits for ${category} have been set.`,
          });
        }
      }
    );
  };

  const handleCancel = () => {
    setEditingCategory(null);
  };

  const handleAddCategory = () => {
    const category = (categoryChoice === "custom" ? customCategory : categoryChoice).trim();
    if (!category) return;
    if (
      archivedCategories.some(
        (archived) => archived.category.toLocaleLowerCase() === category.toLocaleLowerCase(),
      )
    ) {
      toast({
        title: "Category is archived",
        description: "Restore the existing category to keep its previous plan.",
        variant: "destructive",
      });
      return;
    }
    if (categories.some((existing) => existing.toLocaleLowerCase() === category.toLocaleLowerCase())) {
      toast({
        title: "Category already available",
        description: "Choose the existing category instead of adding a duplicate.",
        variant: "destructive",
      });
      return;
    }
    updateBudget.mutate({
      category,
      monthlyLimit: 0,
      windows: [{
        id: crypto.randomUUID(),
        monthlyLimit: 0,
        endMode: "lifelong",
      }],
    }, {
      onSuccess: () => {
        trackEvent("planning_category_added", {
          category_type: getBudgetCategoryType(category, CORE_CATEGORIES, OPTIONAL_CATEGORIES),
        });
        setAddCategoryOpen(false);
        setCategoryChoice("");
        setCustomCategory("");
        toast({ title: "Planning category added", description: `${category} is ready to plan.` });
      },
    });
  };

  const historicalExpenseCount = manageCategoryName
    ? expenses.filter((expense) => expense.category === manageCategoryName).length
    : 0;

  const openCategoryManager = (category: string) => {
    setManageCategoryName(category);
    setRenamedCategory(category);
  };

  const handleCategoryChange = (archive: boolean) => {
    if (!manageCategoryName || !isCustomPlanningCategory(manageCategoryName)) return;
    const nextCategory = archive ? undefined : renamedCategory.trim();
    if (!archive && !nextCategory) return;
    if (
      nextCategory
      && nextCategory.toLocaleLowerCase() !== manageCategoryName.toLocaleLowerCase()
      && categories.some((category) =>
        category.toLocaleLowerCase() === nextCategory.toLocaleLowerCase()
      )
    ) {
      toast({
        title: "Category already available",
        description: "Choose a different name.",
        variant: "destructive",
      });
      return;
    }
    manageCategory.mutate(
      { category: manageCategoryName, action: archive ? "archive" : "rename", nextCategory },
      {
        onSuccess: () => {
          setManageCategoryName(null);
          toast({
            title: archive ? "Planning category archived" : "Planning category renamed",
            description: historicalExpenseCount > 0
              ? `${historicalExpenseCount} existing expense${historicalExpenseCount === 1 ? "" : "s"} still use “${manageCategoryName}”.`
              : archive
                ? "The category was removed from Budgets."
                : `The plan now uses “${nextCategory}”.`,
          });
        },
      },
    );
  };

  const handleRestoreCategory = (category: string, hasStoredPlan: boolean) => {
    manageCategory.mutate(
      { category, action: "restore" },
      {
        onSuccess: () => {
          trackEvent("planning_category_restored", {
            had_previous_plan: hasStoredPlan,
          });
          toast({
            title: "Planning category restored",
            description: hasStoredPlan
              ? `${category} is back in Budgets with its saved plan.`
              : `${category} is back in Budgets with a new empty plan because no prior plan was available.`,
          });
        },
      },
    );
  };

  if (loadingBudgets || loadingExpenses) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-primary/20 rounded-full mb-4"></div>
          <p className="text-muted-foreground">Loading your budgets...</p>
        </div>
      </div>
    );
  }

  const totalBudget = categoryData.reduce((sum, c) => sum + c.limit, 0);
  const totalSpent = categoryData.reduce((sum, c) => sum + c.spent, 0);

  return (
    <div className="space-y-5 animate-in fade-in duration-500 pb-10 md:space-y-6">
      <div className="relative flex flex-col justify-between gap-3 md:flex-row md:items-end md:gap-4">
        <div className="pr-12 md:pr-0">
          <h1 className="font-serif text-2xl leading-tight text-primary md:text-3xl">Expenses</h1>
          <p className="mt-1 text-sm leading-5 text-muted-foreground md:text-base md:leading-6">
            Adjust the budget plan that guides your everyday spending.
          </p>
        </div>
        <div className="absolute right-0 top-0 z-20 md:hidden">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-9 w-9 rounded-full border border-border/70 bg-background/90 text-foreground shadow-sm backdrop-blur-sm hover:bg-muted"
                aria-label="Expense category actions"
              >
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setArchivedCategoriesOpen(true);
                  trackEvent("archived_categories_opened");
                }}
                data-testid="button-view-archived-categories"
              >
                <ArchiveRestore className="mr-2 h-4 w-4" />
                Archived categories{archivedCategories.length > 0 ? ` (${archivedCategories.length})` : ""}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setAddCategoryOpen(true);
                  trackEvent("planning_category_opened");
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add planning category
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="hidden md:flex md:w-auto md:gap-2">
          <Button
            type="button"
            variant="ghost"
            className="min-w-0 px-2.5 text-xs sm:px-3 sm:text-sm"
            onClick={() => {
              setArchivedCategoriesOpen(true);
              trackEvent("archived_categories_opened");
            }}
            data-testid="button-view-archived-categories"
            aria-label={`Archived categories${archivedCategories.length > 0 ? ` (${archivedCategories.length})` : ""}`}
          >
            <ArchiveRestore className="mr-1.5 h-4 w-4 sm:mr-2" />
            <span className="sm:hidden">
              Archived{archivedCategories.length > 0 ? ` (${archivedCategories.length})` : ""}
            </span>
            <span className="hidden sm:inline">
              Archived categories{archivedCategories.length > 0 ? ` (${archivedCategories.length})` : ""}
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-w-0 px-2.5 text-xs sm:px-3 sm:text-sm"
            onClick={() => {
              setAddCategoryOpen(true);
              trackEvent("planning_category_opened");
            }}
            aria-label="Add planning category"
          >
            <Plus className="mr-1.5 h-4 w-4 sm:mr-2" />
            <span className="sm:hidden">Add category</span>
            <span className="hidden sm:inline">Add planning category</span>
          </Button>
        </div>
      </div>

      <ExpenseModeSwitch />

      <Card className="bg-primary text-primary-foreground border-0 shadow-md">
        <CardContent className="flex flex-col items-start justify-between gap-4 p-4 md:flex-row md:items-center md:gap-6 md:p-8">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 md:h-14 md:w-14">
              <Target className="h-6 w-6 text-primary-foreground md:h-7 md:w-7" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-primary-foreground/80 md:text-sm">Total Monthly Budget</p>
              <p className="font-sans text-2xl font-bold leading-tight tabular-nums md:text-3xl">
                {totalBudget > 0 ? formatINR(totalBudget) : "Not set yet"}
              </p>
            </div>
          </div>
          {totalBudget > 0 ? (
            <div className="w-full md:w-1/2 space-y-2">
              <div className="flex justify-between text-xs leading-5 tabular-nums md:text-sm">
                <span>{formatINR(totalSpent)} spent</span>
                <span>{formatINR(Math.max(totalBudget - totalSpent, 0))} remaining</span>
              </div>
              <Progress
                value={Math.min((totalSpent / totalBudget) * 100, 100)}
                className="h-1.5 bg-primary-foreground/20 [&>div]:bg-primary-foreground md:h-2"
              />
            </div>
          ) : (
            <p className="w-full text-xs leading-5 text-primary-foreground/90 md:w-1/2 md:text-sm md:leading-relaxed">
              Set a limit on any category below. The total becomes the monthly lifestyle your
              retirement corpus is planned to fund for the rest of your life.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="min-w-0 text-base font-semibold text-foreground sm:text-lg">
          Budget categories
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            ({sortedCategoryData.length})
          </span>
        </h2>
        {sortedCategoryData.length > 1 && (
          <BudgetCardSortControls
            value={sortBy}
            direction={sortDirection}
            options={
              [
                { value: "category", label: "Category" },
                { value: "limit", label: "Budget" },
                { value: "spent", label: "Spent" },
                { value: "remaining", label: "Remaining" },
                { value: "usage", label: "Usage" },
              ] satisfies { value: BudgetSortBy; label: string }[]
            }
            onByChange={setSortBy}
            onDirectionChange={setSortDirection}
            compactOnMobile
            className="shrink-0"
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        {sortedCategoryData.map((data) => (
          <Card key={data.category} className={`relative border-0 shadow-sm transition-all ${data.overBudget && data.hasBudget ? 'border-l-4 border-l-destructive bg-destructive/5' : 'bg-card'}`}>
            <div className="relative flex items-center justify-between gap-3 p-4 pb-2 md:p-6 md:pb-2">
              <div className="flex min-w-0 items-center gap-3 pr-20">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${CATEGORY_ICON_TONE}`}
                >
                  <data.Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="truncate text-[15px] font-semibold leading-5" title={data.category}>
                    {data.category}
                  </CardTitle>
                  <CardDescription className="mt-0.5 truncate text-[13px] leading-5 tabular-nums">
                    {data.hasBudget
                      ? `${formatINR(data.spent)} of ${formatINR(data.limit)}`
                      : data.hasPlan
                        ? "No budget is active this month"
                        : "No limit set"}
                  </CardDescription>
                </div>
              </div>
              
              {editingCategory === data.category ? (
                <div className="absolute right-4 top-4 z-10 flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleSave(data.category)}
                    className="h-8 w-8 text-emerald-600"
                    aria-label={`Save ${data.category} budget`}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleCancel}
                    className="h-8 w-8 text-muted-foreground"
                    aria-label={`Cancel editing ${data.category} budget`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="absolute right-4 top-4 z-10 flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleEdit(data.category, data)}
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    aria-label={`Edit ${data.category} budget`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {isCustomPlanningCategory(data.category) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                          aria-label={`Manage ${data.category} category`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openCategoryManager(data.category)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Rename or archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )}
            </div>
            <CardContent className="px-4 pb-4 pt-2 md:px-6 md:pb-6">
              {editingCategory === data.category ? (
                <div className="space-y-4 mt-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground flex items-center gap-2 cursor-pointer">
                      <Switch
                        checked={showAdvanced}
                        onCheckedChange={(checked) => {
                          setShowAdvanced(checked);
                          trackEvent("future_planning_toggled", { enabled: checked });
                          if (checked && editWindows.length === 0) {
                            setEditWindows([{
                              id: crypto.randomUUID(),
                              monthlyLimit: Number(editAmount) || 0,
                              endMode: "lifelong",
                            }]);
                          }
                        }}
                        aria-label={`Plan future changes for ${data.category}`}
                      />
                      Plan future changes
                    </Label>
                  </div>

                  {showAdvanced ? (
                    <BudgetEditor
                      windows={editWindows}
                      onChange={setEditWindows}
                      retirementInputs={retirementInputs}
                      onInteraction={(outcome, data) => {
                        trackEvent(`budget_${outcome}`, data);
                      }}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground font-medium">₹</span>
                      <Input
                        type="number"
                        formatWithCommas
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        placeholder="Enter current limit"
                        className="h-9"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSave(data.category);
                          if (e.key === 'Escape') handleCancel();
                        }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-1 space-y-2">
                  {data.activeWindows.length > 1 && (
                    <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                      {data.activeWindows.length} periods overlap this month. Their amounts add to {formatINR(data.limit)}.
                    </p>
                  )}
                  {data.activeWindows.some((window) => window.note) && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {data.activeWindows.map((window) => window.note).filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {data.upcomingWindow?.startDate && (
                    <p className="text-xs text-primary">
                      Next change: {format(parseDateOnly(data.upcomingWindow.startDate), "MMM yyyy")} · {formatINR(data.upcomingWindow.monthlyLimit)}/mo
                      {data.upcomingWindow.note ? ` · ${data.upcomingWindow.note}` : ""}
                    </p>
                  )}
                  <div className="mb-1 flex justify-between text-xs leading-5 tabular-nums">
                    <span className={data.overBudget && data.hasBudget ? "text-destructive font-medium" : "text-muted-foreground"}>
                      {data.hasBudget 
                        ? `${data.percentUsed.toFixed(0)}% used` 
                        : (data.spent > 0 ? `${formatINR(data.spent)} spent` : "No spending")}
                    </span>
                    {data.hasBudget && !data.overBudget && (
                      <span className="text-muted-foreground">{formatINR(data.remaining)} left</span>
                    )}
                    {data.overBudget && data.hasBudget && (
                      <span className="text-destructive font-medium">{formatINR(data.spent - data.limit)} over limit</span>
                    )}
                  </div>
                  {data.hasBudget && (
                    <Progress 
                      value={Math.min(data.percentUsed, 100)} 
                      className={data.overBudget ? "h-1.5 [&>div]:bg-destructive" : "h-1.5"}
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={addCategoryOpen} onOpenChange={setAddCategoryOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl p-5 sm:p-6">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="text-xl leading-6">Add a planning category</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              Add only the long-term costs that matter to your household. Core categories stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="planning-category-choice" className="text-sm font-semibold">Category</Label>
              <Select value={categoryChoice} onValueChange={setCategoryChoice}>
                <SelectTrigger id="planning-category-choice" className="h-11 rounded-lg">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {OPTIONAL_CATEGORIES
                    .filter((category) => !categories.includes(category))
                    .map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  <SelectItem value="custom">Custom category</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {categoryChoice === "custom" && (
              <div className="space-y-2">
                <Label htmlFor="custom-planning-category">Custom category name</Label>
                <Input
                  id="custom-planning-category"
                  value={customCategory}
                  onChange={(event) => setCustomCategory(event.target.value)}
                  maxLength={80}
                  placeholder="e.g. Pet care"
                  className="h-11 rounded-lg"
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleAddCategory();
                  }}
                />
              </div>
            )}
          </div>
          <DialogFooter className="grid grid-cols-2 gap-3 pt-1 sm:flex sm:gap-2">
            <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={() => setAddCategoryOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="h-11 rounded-lg"
              onClick={handleAddCategory}
              disabled={!categoryChoice || (categoryChoice === "custom" && !customCategory.trim()) || updateBudget.isPending}
            >
              Add category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archivedCategoriesOpen} onOpenChange={setArchivedCategoriesOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md rounded-xl p-5 sm:p-6">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="text-xl leading-6">Archived planning categories</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              Restore a category to Budgets. Its previous plan is kept when available, and historical expenses are never changed.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55dvh] space-y-3 overflow-y-auto py-1 pr-0.5">
            {archivedCategories.length === 0 ? (
              <p className="rounded-lg bg-muted/70 px-4 py-4 text-sm leading-5 text-muted-foreground" data-testid="status-no-archived-categories">
                You have no archived custom categories.
              </p>
            ) : archivedCategories.map(({ category, budget }) => (
              <div
                key={category}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3"
                data-testid={`row-archived-category-${category}`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{category}</p>
                  <p className="text-xs text-muted-foreground">
                    {budget?.windows?.some((window) => window.monthlyLimit > 0)
                      ? "Previous plan available"
                      : "No previous plan set"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleRestoreCategory(category, Boolean(budget))}
                  disabled={manageCategory.isPending}
                  data-testid={`button-restore-category-${category}`}
                >
                  <ArchiveRestore className="mr-2 h-4 w-4" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(manageCategoryName)}
        onOpenChange={(open) => {
          if (!open) setManageCategoryName(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage planning category</DialogTitle>
            <DialogDescription>
              Renaming changes the budget plan only. Existing ledger expenses keep using
              “{manageCategoryName}” and are never rewritten or deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="renamed-planning-category">Category name</Label>
              <Input
                id="renamed-planning-category"
                value={renamedCategory}
                onChange={(event) => setRenamedCategory(event.target.value)}
                maxLength={80}
                autoFocus
              />
            </div>
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {historicalExpenseCount > 0
                ? `${historicalExpenseCount} existing expense${historicalExpenseCount === 1 ? "" : "s"} will continue to use the old category.`
                : "No existing expenses use this category."}
            </p>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => handleCategoryChange(true)}
              disabled={manageCategory.isPending}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive from Budgets
            </Button>
            <Button
              type="button"
              onClick={() => handleCategoryChange(false)}
              disabled={
                !renamedCategory.trim()
                || renamedCategory.trim() === manageCategoryName
                || manageCategory.isPending
              }
            >
              Save new name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
