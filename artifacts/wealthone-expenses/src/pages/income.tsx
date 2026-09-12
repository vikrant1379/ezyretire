import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useIncomeSources, useAddIncomeSource, useUpdateIncomeSource, useDeleteIncomeSource, calculateIncomeMetrics } from "@/hooks/use-income";
import {
  useAddIncomeReceipt,
  useDeleteIncomeReceipt,
  useIncomeReceipts,
  useUpdateIncomeReceipt,
} from "@/hooks/use-income-receipts";
import { formatCompactINR, formatINR } from "@/lib/utils";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@workspace/wealthone-design-system/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@workspace/wealthone-design-system/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@workspace/wealthone-design-system/components/ui/dropdown-menu";
import { Form, FormControl, FormDescription, FormField, FormFieldHeader, FormItem, FormLabel, FormMessage } from "@workspace/wealthone-design-system/components/ui/form";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { Textarea } from "@workspace/wealthone-design-system/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { Plus, Briefcase, Pencil, Info, Calculator, MoreVertical, Trash2, CircleDollarSign } from "lucide-react";
import { DatePickerInput } from "@workspace/wealthone-design-system/components/ui/date-picker-input";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { formatDateOnly, parseDateOnly, type IncomeType, type IncomeFrequency, type SalaryDetails, type IncomeReceipt, type IncomeSource } from "@/lib/storage";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { useProfileInputs, useRetirementInputs } from "@/hooks/use-retirement";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { datedFundNetAmount } from "@/lib/financial-metrics";
import { financialHealthCompletionCallbacks } from "@/lib/financial-health-analytics";
import {
  defaultUiPreferences,
  pendingSortAfterConfirmation,
  sortIncomeSources,
  type IncomeSortBy,
  type ListSort,
} from "@/lib/card-order";
import {
  useUiPreferences,
  useUpdateUiPreferences,
} from "@/hooks/use-ui-preferences";
import {
  SortableCard,
  SortableCardList,
} from "@/components/sortable-card-list";
import { CardSortControls } from "@/components/card-sort-controls";
import { DownloadExcelButton } from "@/components/download-excel-button";
import { buildIncomeReportSheets } from "@/lib/excel-report-builders";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/wealthone-design-system/components/ui/popover";
import { QueryErrorState } from "@/components/query-error-state";
import {
  calculateIncomeTax,
  financialYearForDate,
  INDIAN_INCOME_TAX_RULES,
  type FinancialYear,
} from "@/lib/income-tax";
import { incomeReconciliationForMonth } from "@/lib/income-reconciliation";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const incomeTypes: IncomeType[] = ['Salary', 'Bonus', 'Freelance/Consulting', 'Rental', 'Dividends', 'Interest', 'Business', 'Capital Gains', 'Other'];
const frequencies: IncomeFrequency[] = ['Monthly', 'Annual', 'One-time'];
const supportedFinancialYears = Object.keys(INDIAN_INCOME_TAX_RULES) as FinancialYear[];
const calendarFinancialYear = financialYearForDate(new Date());
const defaultFinancialYear = supportedFinancialYears.includes(calendarFinancialYear as FinancialYear)
  ? calendarFinancialYear as FinancialYear
  : supportedFinancialYears.at(-1) ?? "2026-27";
const nextFinancialYear = (() => {
  const startYear = Number(calendarFinancialYear.slice(0, 4)) + 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
})();

function InfoLabel({ children, info }: { children: ReactNode; info: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <FormLabel>{children}</FormLabel>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`More information about ${String(children)}`}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 text-sm" side="top">
          {info}
        </PopoverContent>
      </Popover>
    </div>
  );
}
const clampGrowthRate = (value: number | undefined, fallback = 0) => {
  const candidate = Number.isFinite(value) ? value as number : fallback;
  return Math.min(50, Math.max(0, Number.isFinite(candidate) ? candidate : 0));
};

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(['Salary', 'Bonus', 'Freelance/Consulting', 'Rental', 'Dividends', 'Interest', 'Business', 'Capital Gains', 'Other'] as const),
  frequency: z.enum(['Monthly', 'Annual', 'One-time'] as const),
  amount: z.coerce.number().min(0).default(0),
  date: z.date(),
  annualGrowthRate: z.coerce.number().finite().min(0).max(50).default(0),
  incomeEndMode: z.enum(["retirement", "custom"]).default("retirement"),
  incomeEndDate: z.date().optional(),
  notes: z.string().optional(),
  
  // Salary details
  grossCTC: z.coerce.number().min(0).default(0),
  grossCTCMode: z.enum(["automatic", "manual"]).default("automatic"),
  basicPay: z.coerce.number().min(0).default(0),
  hra: z.coerce.number().min(0).default(0),
  allowances: z.coerce.number().min(0).default(0),
  employeePF: z.coerce.number().min(0).default(0),
  professionalTax: z.coerce.number().min(0).default(0),
  tds: z.coerce.number().min(0).default(0),
  tdsMode: z.enum(["automatic", "manual"]).default("automatic"),
  taxRegime: z.enum(["new", "old"]).default("new"),
  financialYear: z.enum(["2024-25", "2025-26", "2026-27"]).default(defaultFinancialYear),
  otherDeductions: z.coerce.number().min(0).default(0),
}).superRefine((data, context) => {
  if (data.frequency !== "One-time" && data.incomeEndMode === "custom" && !data.incomeEndDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["incomeEndDate"],
      message: "End date is required for custom availability",
    });
  }
  if (data.type === "Salary") {
    const monthlyEarnings = data.basicPay + data.hra + data.allowances;
    const monthlyDeductions = data.employeePF + data.professionalTax + data.tds + data.otherDeductions;
    if (monthlyEarnings <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["basicPay"],
        message: "Enter at least one monthly salary component",
      });
    }
    if (data.grossCTCMode === "manual" && data.grossCTC < monthlyEarnings * 12) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["grossCTC"],
        message: "Annual CTC cannot be lower than the entered annual salary components",
      });
    }
    if (monthlyDeductions > monthlyEarnings) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["otherDeductions"],
        message: "Monthly deductions cannot exceed monthly earnings",
      });
    }
  }
});

type FormValues = z.infer<typeof formSchema>;

const receiptFormSchema = z.object({
  incomeSourceId: z.string().min(1, "Choose an income source"),
  receivedDate: z.date(),
  amount: z.coerce.number().positive("Enter an amount greater than zero"),
  note: z.string().optional(),
});

type ReceiptFormValues = z.infer<typeof receiptFormSchema>;

export default function Income() {
  const { data: sources = [], isLoading, isError, refetch } = useIncomeSources();
  const { data: receipts = [] } = useIncomeReceipts();
  const { data: retirementInputs } = useRetirementInputs();
  const { data: profileInputs } = useProfileInputs();
  const { data: uiPreferences = defaultUiPreferences() } = useUiPreferences();
  const updatePreferences = useUpdateUiPreferences();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isTaxBreakdownOpen, setIsTaxBreakdownOpen] = useState(false);
  const [sourceToDelete, setSourceToDelete] = useState<IncomeSource | null>(null);
  const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);
  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);
  const [pendingIncomeSort, setPendingIncomeSort] = useState<ListSort<IncomeSortBy> | null>(null);
  const { toast } = useToast();

  const addIncome = useAddIncomeSource();
  const updateIncome = useUpdateIncomeSource();
  const deleteIncome = useDeleteIncomeSource();
  const addReceipt = useAddIncomeReceipt();
  const updateReceipt = useUpdateIncomeReceipt();
  const deleteReceipt = useDeleteIncomeReceipt();
  const isSaving = addIncome.isPending || updateIncome.isPending;

  const metrics = useMemo(() => {
    let totalMonthlyNet = 0;
    let totalAnnualGross = 0;
    let totalAnnualTax = 0;
    let totalDatedFunds = 0;
    const bySource: Record<string, number> = {};

    const currentMonth = new Date();
    currentMonth.setDate(1);
    sources.filter((source) => {
      if (!source.recurring || source.frequency === "One-time" || source.incomeEndMode !== "custom") return true;
      if (!source.incomeEndDate) return true;
      const end = parseDateOnly(source.incomeEndDate);
      return !Number.isFinite(end.getTime())
        || new Date(end.getFullYear(), end.getMonth(), 1) >= currentMonth;
    }).forEach(s => {
      const { monthlyNet, annualGross, annualTax } = calculateIncomeMetrics(s);
      totalMonthlyNet += monthlyNet;
      if (s.frequency === "Monthly" && s.recurring) {
        totalAnnualGross += annualGross;
        totalAnnualTax += annualTax;
      } else if (s.frequency !== "Monthly") {
        totalDatedFunds += datedFundNetAmount(s);
      }
      
      bySource[s.type] = (bySource[s.type] || 0) + monthlyNet;
    });

    const effectiveTaxRate = totalAnnualGross > 0 ? (totalAnnualTax / totalAnnualGross) * 100 : 0;
    
    const pieData = Object.entries(bySource)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return { totalMonthlyNet, totalAnnualGross, totalDatedFunds, effectiveTaxRate, pieData };
  }, [sources]);

  const incomeSort = pendingIncomeSort ?? uiPreferences.incomeSort;
  const effectiveUiPreferences = useMemo(
    () => ({ ...uiPreferences, incomeSort }),
    [uiPreferences, incomeSort],
  );
  const orderedSources = useMemo(
    () => sortIncomeSources(sources, effectiveUiPreferences),
    [sources, effectiveUiPreferences],
  );
  const manualOrder = incomeSort.by === "manual";

  const saveIncomeSort = (nextSort: ListSort<IncomeSortBy>) => {
    setPendingIncomeSort(nextSort);
    updatePreferences.mutate(
      { incomeSort: nextSort },
      {
        onSuccess: (saved) => {
          setPendingIncomeSort((current) =>
            pendingSortAfterConfirmation(current, saved.uiPreferences.incomeSort),
          );
        },
        onError: () => setPendingIncomeSort(null),
      },
    );
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "Salary",
      frequency: "Monthly",
      amount: 0,
      date: new Date(),
      annualGrowthRate: 8,
      incomeEndMode: "retirement",
      notes: "",
      grossCTC: 0,
      grossCTCMode: "automatic",
      basicPay: 0,
      hra: 0,
      allowances: 0,
      employeePF: 0,
      professionalTax: 0,
      tds: 0,
      tdsMode: "automatic",
      taxRegime: "new",
      financialYear: defaultFinancialYear,
      otherDeductions: 0,
    }
  });
  const receiptForm = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: {
      incomeSourceId: "",
      receivedDate: new Date(),
      amount: 0,
      note: "",
    },
  });

  const currentMonthReconciliation = useMemo(() => {
    return incomeReconciliationForMonth({
      sources,
      receipts,
      profileInputs,
      retirementInputs,
    });
  }, [profileInputs, receipts, retirementInputs, sources]);

  const sourceNames = useMemo(
    () => new Map(sources.map((source) => [source.id, source.name])),
    [sources],
  );

  const openReceiptDialog = (receipt?: IncomeReceipt, sourceId?: string) => {
    if (receipt) {
      setEditingReceiptId(receipt.id);
      receiptForm.reset({
        incomeSourceId: receipt.incomeSourceId,
        receivedDate: parseDateOnly(receipt.receivedDate),
        amount: receipt.amount,
        note: receipt.note ?? "",
      });
    } else {
      setEditingReceiptId(null);
      receiptForm.reset({
        incomeSourceId: sourceId ?? sources[0]?.id ?? "",
        receivedDate: new Date(),
        amount: 0,
        note: "",
      });
    }
    setIsReceiptDialogOpen(true);
  };

  const saveReceipt = (values: ReceiptFormValues) => {
    const payload = {
      incomeSourceId: values.incomeSourceId,
      receivedDate: formatDateOnly(values.receivedDate),
      amount: values.amount,
      note: values.note?.trim() || undefined,
    };
    if (editingReceiptId) {
      const existing = receipts.find((receipt) => receipt.id === editingReceiptId);
      if (!existing) return;
      updateReceipt.mutate({ ...existing, ...payload }, {
        onSuccess: () => {
          setIsReceiptDialogOpen(false);
          toast({ title: "Income receipt updated" });
        },
      });
      return;
    }
    addReceipt.mutate(payload, {
      onSuccess: () => {
        setIsReceiptDialogOpen(false);
        toast({ title: "Income receipt recorded" });
      },
    });
  };

  const watchType = form.watch("type");
  const watchFrequency = form.watch("frequency");
  const watchIncomeEndMode = form.watch("incomeEndMode");
  const watchGrossCTCMode = form.watch("grossCTCMode");
  const watchTdsMode = form.watch("tdsMode");
  const watchTaxRegime = form.watch("taxRegime");
  const watchFinancialYear = form.watch("financialYear");
  const watchGrossCTC = form.watch("grossCTC");
  const watchBasicPay = form.watch("basicPay");
  const watchHra = form.watch("hra");
  const watchAllowances = form.watch("allowances");
  const watchEmployeePF = form.watch("employeePF");
  const watchValues = form.watch();

  const isOneTime = watchFrequency === "One-time";

  const automaticGrossCTC = Math.max(
    0,
    ((Number(watchBasicPay) || 0) + (Number(watchHra) || 0) + (Number(watchAllowances) || 0)) * 12,
  );
  const annualCTC = watchGrossCTCMode === "manual"
    ? Math.max(0, Number(watchGrossCTC) || 0)
    : automaticGrossCTC;
  const salaryTaxComparison = useMemo(() => {
    const calculate = (regime: "new" | "old") => calculateIncomeTax({
      financialYear: watchFinancialYear,
      regime,
      income: { salary: annualCTC },
      chapterVIADeductions: regime === "old"
        ? Math.min(150_000, Math.max(0, Number(watchEmployeePF) || 0) * 12)
        : 0,
    });
    return { new: calculate("new"), old: calculate("old") };
  }, [annualCTC, watchEmployeePF, watchFinancialYear]);
  const selectedSalaryTax = salaryTaxComparison[watchTaxRegime];

  useEffect(() => {
    if (watchType === "Salary" && watchGrossCTCMode === "automatic") {
      form.setValue("grossCTC", automaticGrossCTC, { shouldDirty: true, shouldValidate: true });
    }
  }, [automaticGrossCTC, form, watchGrossCTCMode, watchType]);

  useEffect(() => {
    if (watchType !== "Salary" || watchTdsMode !== "automatic") return;
    form.setValue("tds", Math.round(selectedSalaryTax.totalTax / 12), { shouldDirty: true, shouldValidate: true });
  }, [
    form,
    selectedSalaryTax.totalTax,
    watchTdsMode,
    watchType,
  ]);

  const handleOpenDialog = (source?: IncomeSource) => {
    if (source) {
      setEditingId(source.id);
      form.reset({
        name: source.name,
        type: source.type,
        frequency: source.frequency,
        amount: source.amount,
        date: parseDateOnly(source.date),
        annualGrowthRate: clampGrowthRate(
          source.annualGrowthRate,
          source.type === "Salary" && source.recurring && source.frequency !== "One-time"
            ? retirementInputs?.salaryGrowth
            : 0,
        ),
        incomeEndMode: source.incomeEndMode === "custom" ? "custom" : "retirement",
        incomeEndDate: source.incomeEndMode === "custom" && source.incomeEndDate
          ? parseDateOnly(source.incomeEndDate)
          : undefined,
        notes: source.notes || "",
        grossCTC: source.salaryDetails?.grossCTC ?? 0,
        grossCTCMode: source.salaryDetails?.grossCTCMode ?? "manual",
        basicPay: source.salaryDetails?.basicPay ?? 0,
        hra: source.salaryDetails?.hra ?? 0,
        allowances: source.salaryDetails?.allowances ?? 0,
        employeePF: source.salaryDetails?.employeePF ?? 0,
        professionalTax: source.salaryDetails?.professionalTax ?? 0,
        tds: source.salaryDetails?.tds ?? 0,
        tdsMode: source.salaryDetails?.tdsMode ?? "manual",
        taxRegime: source.salaryDetails?.taxRegime ?? "new",
        financialYear: source.salaryDetails?.financialYear ?? defaultFinancialYear,
        otherDeductions: source.salaryDetails?.otherDeductions ?? 0,
      });
    } else {
      setEditingId(null);
      form.reset({
        name: "",
        type: "Salary",
        frequency: "Monthly",
        amount: 0,
        date: new Date(),
        annualGrowthRate: clampGrowthRate(retirementInputs?.salaryGrowth, 8),
        incomeEndMode: "retirement",
        incomeEndDate: undefined,
        notes: "",
        grossCTC: 0,
        grossCTCMode: "automatic",
        basicPay: 0,
        hra: 0,
        allowances: 0,
        employeePF: 0,
        professionalTax: 0,
        tds: 0,
        tdsMode: "automatic",
        taxRegime: "new",
        financialYear: defaultFinancialYear,
        otherDeductions: 0,
      });
    }
    setIsDialogOpen(true);
  };

  const onSubmit = (data: FormValues) => {
    if (isSaving) return;
    const frequency = data.type === "Salary" ? "Monthly" as const : data.frequency;
    const recurring = frequency !== "One-time";
    const salaryDetails: SalaryDetails | undefined = data.type === 'Salary' ? {
      grossCTC: data.grossCTC,
      grossCTCMode: data.grossCTCMode,
      basicPay: data.basicPay,
      hra: data.hra,
      allowances: data.allowances,
      employeePF: data.employeePF,
      professionalTax: data.professionalTax,
      tds: data.tds,
      tdsMode: data.tdsMode,
      taxRegime: data.taxRegime,
      financialYear: data.financialYear,
        taxRuleVersion: `india-income-tax/FY-${data.financialYear}`,
      otherDeductions: data.otherDeductions
    } : undefined;

    const payload = {
      name: data.name,
      type: data.type,
      frequency,
      amount: data.amount,
      date: formatDateOnly(data.date),
      recurring,
      annualGrowthRate: recurring
        ? clampGrowthRate(data.annualGrowthRate)
        : undefined,
      incomeEndMode: recurring
        ? data.incomeEndMode
        : "retirement" as const,
      incomeEndDate: recurring
        && data.incomeEndMode === "custom"
        && data.incomeEndDate
          ? formatDateOnly(data.incomeEndDate)
          : undefined,
      notes: data.notes,
      salaryDetails
    };

    if (editingId) {
      updateIncome.mutate({ ...payload, id: editingId, createdAt: sources.find(s => s.id === editingId)!.createdAt }, financialHealthCompletionCallbacks("income", "updated", () => {
          setIsDialogOpen(false);
          toast({ title: "Income source updated" });
      }));
    } else {
      addIncome.mutate(payload, financialHealthCompletionCallbacks("income", "created", () => {
          setIsDialogOpen(false);
          toast({ title: "Income source added" });
      }));
    }
  };

  // Live calculation for Salary details within the form
  const previewSalary = useMemo(() => {
    if (watchType !== 'Salary') return null;
    const mockSource = {
      id: 'mock',
      name: '',
      type: watchType,
      frequency: watchValues.frequency,
      amount: 0,
      date: new Date().toISOString(),
      recurring: watchValues.frequency !== "One-time",
      createdAt: '',
      salaryDetails: {
        grossCTC: Number(watchValues.grossCTC) || 0,
        basicPay: Number(watchValues.basicPay) || 0,
        hra: Number(watchValues.hra) || 0,
        allowances: Number(watchValues.allowances) || 0,
        employeePF: Number(watchValues.employeePF) || 0,
        professionalTax: Number(watchValues.professionalTax) || 0,
        tds: Number(watchValues.tds) || 0,
        otherDeductions: Number(watchValues.otherDeductions) || 0,
      }
    };
    return {
      ...calculateIncomeMetrics(mockSource),
      paymentNet: Math.max(
        0,
        mockSource.salaryDetails.basicPay
          + mockSource.salaryDetails.hra
          + mockSource.salaryDetails.allowances
          - mockSource.salaryDetails.employeePF
          - mockSource.salaryDetails.professionalTax
          - mockSource.salaryDetails.tds
          - mockSource.salaryDetails.otherDeductions,
      ),
    };
  }, [watchType, watchValues]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-primary/20 rounded-full mb-4"></div>
          <p className="text-muted-foreground">Loading income data...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return <QueryErrorState onRetry={refetch} />;
  }

  const incomeExportSheets = buildIncomeReportSheets(orderedSources, {
    salaryGrowth: retirementInputs?.salaryGrowth,
    receipts,
  });

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-8 md:pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif text-primary">Income</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Manage your salary and other sources of income.
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="shadow-sm w-full md:w-auto">
          <Plus className="h-4 w-4 mr-2" /> Add Income
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
        <Card className="min-w-0 border-0 shadow-md bg-card">
          <CardContent className="p-3.5 sm:p-4 md:p-5 lg:pt-7" data-testid="income-summary-content">
            <p className="text-tiny font-medium uppercase leading-4 tracking-wider text-muted-foreground sm:text-tiny md:text-xs">
              Monthly Net Income
            </p>
            <p className={cn("financial-number mt-2 font-sans text-xl font-bold sm:text-2xl md:text-3xl", metrics.totalMonthlyNet > 0 ? "text-positive" : metrics.totalMonthlyNet < 0 ? "text-negative" : "text-foreground")}>
              <span className="sm:hidden" title={formatINR(metrics.totalMonthlyNet)} aria-label={formatINR(metrics.totalMonthlyNet)}>{formatCompactINR(metrics.totalMonthlyNet)}</span>
              <span className="hidden sm:inline">{formatINR(metrics.totalMonthlyNet)}</span>
            </p>
            <p className="mt-3 text-tiny leading-4 text-muted-foreground sm:text-xs md:mt-4 md:text-sm">Monthly sources only</p>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-0 shadow-md bg-card">
          <CardContent className="p-3.5 sm:p-4 md:p-5 lg:pt-7" data-testid="income-summary-content">
            <p className="text-tiny font-medium uppercase leading-4 tracking-wider text-muted-foreground sm:text-tiny md:text-xs">
              Monthly Income Annualized Gross
            </p>
            <p className={cn("financial-number mt-2 font-sans text-xl font-bold sm:text-2xl md:text-3xl", metrics.totalAnnualGross > 0 ? "text-positive" : metrics.totalAnnualGross < 0 ? "text-negative" : "text-foreground")}>
              <span className="sm:hidden" title={formatINR(metrics.totalAnnualGross)} aria-label={formatINR(metrics.totalAnnualGross)}>{formatCompactINR(metrics.totalAnnualGross)}</span>
              <span className="hidden sm:inline">{formatINR(metrics.totalAnnualGross)}</span>
            </p>
            <p className="mt-3 text-tiny leading-4 text-muted-foreground sm:text-xs md:mt-4 md:text-sm">
              <span className="sm:hidden">Before deductions</span>
              <span className="hidden sm:inline">Monthly sources × 12, before deductions</span>
            </p>
          </CardContent>
        </Card>

        <Card className="col-span-2 border-0 bg-card shadow-md xl:col-span-1">
          <CardContent className="p-4 md:p-5 lg:pt-7" data-testid="income-summary-content">
            <p className="text-tiny font-medium uppercase tracking-wider text-muted-foreground md:text-xs">
              Effective Tax Rate
            </p>
            <p className="financial-number mt-2 font-sans text-xl font-bold text-foreground sm:text-2xl md:text-3xl">
              {metrics.effectiveTaxRate.toFixed(2)}%
            </p>
            <p className="mt-3 text-xs text-muted-foreground md:mt-4 md:text-sm">
              Estimated blend across recurring monthly sources
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm bg-card">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 p-4 md:p-6">
          <div>
            <CardTitle className="text-base font-serif md:text-lg">Received Income</CardTitle>
            <CardDescription className="mt-1">
              Record what actually arrived without changing your expected schedule.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => openReceiptDialog()}
            disabled={sources.length === 0}
          >
            <Plus className="mr-2 h-4 w-4" />
            Record receipt
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0 md:p-6 md:pt-0">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">Expected this month</p>
              <p className={cn("mt-1 font-semibold tabular-nums", currentMonthReconciliation.expected > 0 ? "text-positive" : "text-foreground")}>{formatINR(currentMonthReconciliation.expected)}</p>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">Received this month</p>
              <p className={cn("mt-1 font-semibold tabular-nums", currentMonthReconciliation.received > 0 ? "text-positive" : "text-foreground")}>{formatINR(currentMonthReconciliation.received)}</p>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">Variance</p>
              <p className={cn(
                "mt-1 font-semibold tabular-nums",
                  currentMonthReconciliation.variance < 0
                   ? "text-negative"
                  : currentMonthReconciliation.variance > 0
                    ? "text-positive"
                    : "text-foreground",
              )}>
                {currentMonthReconciliation.variance > 0 ? "+" : ""}
                {formatINR(currentMonthReconciliation.variance)}
              </p>
            </div>
          </div>
          {receipts.length > 0 ? (
            <div className="divide-y rounded-xl border">
              {receipts.map((receipt) => (
                <div key={receipt.id} className="flex items-center justify-between gap-3 p-3 md:p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <CircleDollarSign className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {sourceNames.get(receipt.incomeSourceId) ?? "Income source"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseDateOnly(receipt.receivedDate), "MMM d, yyyy")}
                        {receipt.note ? ` · ${receipt.note}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className={cn("mr-1 text-sm font-semibold tabular-nums", receipt.amount > 0 ? "text-positive" : "text-foreground")}>{formatINR(receipt.amount)}</span>
                    <Button variant="ghost" size="icon" onClick={() => openReceiptDialog(receipt)} aria-label="Edit income receipt">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmDeleteButton
                      variant="ghost"
                      itemName={`${sourceNames.get(receipt.incomeSourceId) ?? "income"} receipt`}
                      entityLabel="income receipt"
                      onConfirm={() => deleteReceipt.mutate(receipt.id, {
                        onSuccess: () => toast({ title: "Income receipt deleted" }),
                      })}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
              {sources.length === 0
                ? "Add an income source before recording receipts."
                : "No income has been marked as received yet."}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <Card className="border-0 shadow-sm bg-card lg:col-span-2">
          <CardHeader className="relative flex flex-col items-start justify-between gap-3 space-y-0 p-4 md:p-6 sm:flex-row sm:items-center">
            <CardTitle className="text-base font-serif md:text-lg">Income Sources</CardTitle>
            <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
              {sources.length > 0 ? (
                <CardSortControls
                  value={incomeSort.by}
                  direction={incomeSort.direction}
                  options={
                    [
                      { value: "manual", label: "Custom Order" },
                      { value: "monthly", label: "Monthly Net" },
                      { value: "annual", label: "Annual Gross" },
                      { value: "growth", label: "Annual Growth" },
                    ] satisfies { value: IncomeSortBy; label: string }[]
                  }
                  onByChange={(by) => saveIncomeSort({ ...incomeSort, by })}
                  onDirectionChange={(direction) => saveIncomeSort({ ...incomeSort, direction })}
                  compactOnMobile
                  className="order-1 sm:order-2"
                />
              ) : null}
              <DownloadExcelButton
                sheets={incomeExportSheets}
                reportSlug="income_sources_report"
                size="sm"
                className="max-w-full text-xs sm:order-1"
                mobileTriggerClassName="order-2"
                mobileDirectDownload
                confirmBeforeDownload
              />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
            {orderedSources.length > 0 ? (
              <SortableCardList
                ids={orderedSources.map((source) => source.id)}
                enabled={manualOrder}
                onReorder={(incomeOrder) =>
                  updatePreferences.mutate({ incomeOrder })
                }
              >
                {orderedSources.map((source) => {
                  const m = calculateIncomeMetrics(source);
                  const now = new Date();
                  const sourceDate = parseDateOnly(source.date);
                  const endDate = source.incomeEndDate ? parseDateOnly(source.incomeEndDate) : null;
                  const ended = source.recurring
                    && source.frequency !== "One-time"
                    && source.incomeEndMode === "custom"
                    && endDate
                    && Number.isFinite(endDate.getTime())
                    && new Date(now.getFullYear(), now.getMonth(), 1) > new Date(endDate.getFullYear(), endDate.getMonth(), 1);
                    const datedOnce = source.frequency === "One-time";
                   const upcoming = datedOnce
                    && Number.isFinite(sourceDate.getTime())
                    && sourceDate > now;
                   const status = ended ? "Ended" : upcoming ? "Upcoming" : datedOnce ? "Ended" : "Active";
                  return (
                    <SortableCard key={source.id} id={source.id} enabled={manualOrder}>
                      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-start gap-4 pr-9 md:pr-0">
                         <div className="h-10 w-10 shrink-0 rounded-full bg-muted text-muted-foreground flex items-center justify-center mt-1">
                          <Briefcase className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="break-words font-semibold text-base">{source.name}</p>
                          <p className="text-sm text-muted-foreground">{source.type} • {source.frequency}</p>
                          <p className="mt-1 text-xs text-muted-foreground" data-testid={`status-income-${source.id}`}>
                            <span className={cn(
                              "font-semibold",
                               "text-muted-foreground",
                            )}>{status}</span>
                            {source.frequency === "Annual" && Number.isFinite(sourceDate.getTime())
                              ? ` · Occurs yearly on ${format(sourceDate, "MMM d")}${
                                  source.incomeEndMode === "custom" && source.incomeEndDate
                                    ? ` through ${format(parseDateOnly(source.incomeEndDate), "MMM yyyy")}`
                                    : " until retirement"
                                }`
                              : source.frequency === "Monthly"
                              ? source.incomeEndMode === "custom" && source.incomeEndDate
                                ? ` · Monthly through ${format(parseDateOnly(source.incomeEndDate), "MMM yyyy")}`
                                : " · Monthly until retirement"
                              : Number.isFinite(sourceDate.getTime()) ? ` · Available once on ${format(sourceDate, "MMM d, yyyy")}` : ""}
                          </p>
                          {source.recurring && source.frequency !== "One-time" && (
                            <p className="mt-1 text-xs font-medium text-muted-foreground">
                              Annual growth: {clampGrowthRate(
                                source.annualGrowthRate,
                                source.type === "Salary" ? retirementInputs?.salaryGrowth : 0,
                              ).toFixed(2)}%
                            </p>
                          )}
                          {source.type === 'Salary' && (
                            <div className="flex flex-wrap gap-2 mt-2">
                               <span className="inline-flex max-w-full flex-wrap items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                                 Gross: <span className="text-positive">{formatINR(m.annualGross)}</span>/yr
                              </span>
                                <span className="inline-flex max-w-full flex-wrap items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                                 {source.frequency === "Monthly"
                                    ? <>Net: <span className="text-positive">{formatINR(m.monthlyNet)}</span>/mo</>
                                    : <>Fund: <span className="text-positive">{formatINR(datedFundNetAmount(source))}</span></>}
                               </span>
                                {source.recurring && source.frequency === "Monthly" && (source.salaryDetails?.employeePF || 0) > 0 && (
                                   <span className="inline-flex max-w-full flex-wrap items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                                     PF synced: <span className="text-positive">{formatINR(source.salaryDetails!.employeePF)}</span>/mo
                                 </span>
                               )}
                            </div>
                          )}
                          {source.type !== 'Salary' && (
                            <div className="flex min-w-0 gap-2 mt-2">
                               <span className="inline-flex max-w-full flex-wrap items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                                  <span className="text-positive">{formatINR(source.amount)}</span> {source.frequency === 'Monthly'
                                   ? '/mo'
                                    : source.frequency === 'Annual'
                                     ? 'each year'
                                     : 'lump sum'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="absolute -right-1 -top-1 md:hidden">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-full"
                              aria-label={`Actions for ${source.name}`}
                            >
                              <MoreVertical className="h-5 w-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-36">
                            <DropdownMenuItem onSelect={() => handleOpenDialog(source)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setSourceToDelete(source)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="hidden items-center gap-2 md:flex md:self-center">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleOpenDialog(source)}
                          aria-label={`Edit ${source.name}`}
                        >
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <ConfirmDeleteButton
                          variant="outline"
                          itemName={source.name || "this income source"}
                          entityLabel="income source"
                          onConfirm={() => {
                            deleteIncome.mutate(source.id, {
                              onSuccess: () => toast({ title: "Income source deleted" }),
                            });
                          }}
                        />
                      </div>
                      </div>
                    </SortableCard>
                  );
                })}
              </SortableCardList>
            ) : (
              <div className="w-full py-16 flex flex-col items-center text-muted-foreground border border-dashed rounded-xl">
                <Briefcase className="h-12 w-12 mb-3 opacity-20" />
                <p>No income sources recorded.</p>
                <Button variant="link" onClick={() => handleOpenDialog()} className="mt-2 text-primary">
                  Add your first income source
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-card">
          <CardHeader className="p-4 md:p-6 md:pb-4">
            <CardTitle className="text-base md:text-lg font-serif">Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0 flex flex-col items-center justify-center gap-4 md:gap-6">
            {metrics.pieData.length > 0 ? (
              <>
                <div className="w-[200px] h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={metrics.pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                      >
                        {metrics.pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(value: number) => formatINR(value)}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mx-auto w-full max-w-[19rem] flex-1 space-y-2 md:mx-0 md:max-w-none md:space-y-3">
                  {metrics.pieData.map((entry, index) => (
                    <div key={entry.name} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                        />
                        <span className="truncate text-sm font-medium" title={entry.name}>{entry.name}</span>
                      </div>
                       <span className="financial-number text-right text-sm text-positive">{formatINR(entry.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="w-full py-12 flex flex-col items-center text-muted-foreground">
                <PieChart className="h-12 w-12 mb-3 opacity-20" />
                <p>No data to display.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>{editingReceiptId ? "Edit income receipt" : "Record received income"}</DialogTitle>
            <DialogDescription>
              Enter the amount that actually arrived. Partial and extra payments do not change the source schedule.
            </DialogDescription>
          </DialogHeader>
          <Form {...receiptForm}>
            <form onSubmit={receiptForm.handleSubmit(saveReceipt)} className="space-y-4">
              <FormField
                control={receiptForm.control}
                name="incomeSourceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Income source</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Choose a source" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {sources.map((source) => (
                          <SelectItem key={source.id} value={source.id}>{source.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={receiptForm.control}
                name="receivedDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date received</FormLabel>
                    <FormControl>
                      <DatePickerInput value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={receiptForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount received (₹)</FormLabel>
                    <FormControl>
                      <Input type="number" min="0.01" step="0.01" formatWithCommas {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={receiptForm.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Note (optional)</FormLabel>
                    <FormControl><Textarea placeholder="Payslip, bonus, adjustment…" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsReceiptDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={addReceipt.isPending || updateReceipt.isPending}>
                  {editingReceiptId ? "Save changes" : "Record receipt"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(sourceToDelete)}
        onOpenChange={(open) => {
          if (!open) setSourceToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {sourceToDelete?.name || "this income source"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this income source and its linked receipt history.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!sourceToDelete) return;
                deleteIncome.mutate(sourceToDelete.id, {
                  onSuccess: () => {
                    toast({ title: "Income source deleted" });
                    setSourceToDelete(null);
                  },
                });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-3xl rounded-xl p-6 flex flex-col gap-0">
          <DialogHeader className="shrink-0 pb-4">
            <DialogTitle>{editingId ? 'Edit Income Source' : 'Add Income Source'}</DialogTitle>
            <DialogDescription>
              Enter the details of your income. The amounts for editable fields are highlighted in blue.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-1 space-y-4 md:space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Source Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Tech Corp Salary" className="text-secondary font-medium" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                       <InfoLabel
                         info={watchFrequency === "Monthly"
                           ? "The annual growth repeats once a year on this date."
                           : watchFrequency === "Annual"
                             ? "This payment becomes available once each year on this month and day."
                             : "This fund becomes available once on the selected date."}
                       >
                         {watchFrequency === "Monthly"
                           ? "Growth effective date"
                           : watchFrequency === "Annual"
                             ? "Annual payment date"
                             : "Fund availability date"}
                       </InfoLabel>
                      <FormControl>
                        <DatePickerInput
                          value={field.value}
                          onChange={field.onChange}
                          minDate={new Date(1950, 0, 1)}
                           maxDate={new Date(new Date().getFullYear() + 100, 11, 31)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Income Type</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          if (value === "Salary") form.setValue("frequency", "Monthly");
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="text-secondary font-medium">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {incomeTypes.map((type) => (
                            <SelectItem key={type} value={type}>{type}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="frequency"
                  render={({ field }) => (
                    <FormItem>
                      <InfoLabel
                        info={watchFrequency === "Monthly"
                          ? watchType === "Salary"
                            ? "Salary is monthly cash flow until its expiry. Use Bonus for yearly bonus payments."
                            : "Occurs monthly until its expiry."
                          : watchFrequency === "Annual"
                            ? "Occurs yearly on the annual payment date until its expiry."
                            : "Occurs once on the fund availability date."}
                      >
                        Frequency
                      </InfoLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="text-secondary font-medium">
                            <SelectValue placeholder="Select frequency" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {frequencies.filter((freq) => watchType !== "Salary" || freq === "Monthly").map((freq) => (
                            <SelectItem key={freq} value={freq}>{freq}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {watchType !== 'Salary' && (
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount (₹)</FormLabel>
                      <FormControl>
                        <Input type="number" formatWithCommas placeholder="0" className="text-secondary font-medium" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {watchType === 'Salary' && (
                <div className="bg-muted/30 p-4 rounded-xl border border-border/50 space-y-6">
                   <div>
                     <div className="mb-3">
                       <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-sm font-semibold">Earnings (monthly)</h3>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button type="button" className="rounded-full text-muted-foreground hover:text-foreground" aria-label="About monthly earnings">
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-72 text-sm" side="top">
                                Enter gross monthly payslip components before employee PF, TDS, professional tax, or other deductions.
                              </PopoverContent>
                            </Popover>
                          </div>
                       </div>
                     </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="grossCTC"
                        render={({ field }) => (
                          <FormItem>
                             <FormFieldHeader className="flex-wrap justify-start gap-x-2 gap-y-1 md:min-h-10">
                               <InfoLabel info="Gross annual earnings before employee PF, TDS, professional tax, and other payroll deductions. Tax is estimated from this amount; it is not added into CTC.">
                                 Annual gross CTC
                               </InfoLabel>
                               <span className="text-xs font-normal text-muted-foreground">(Auto-calculated if 0)</span>
                             </FormFieldHeader>
                            <FormControl>
                               <Input
                                 type="number"
                                 formatWithCommas
                                  className="font-medium text-secondary"
                                  {...field}
                                   onChange={(event) => {
                                     field.onChange(event);
                                     const value = Number(event.currentTarget.value.replace(/,/g, ""));
                                     if (value > 0) {
                                       form.setValue("grossCTCMode", "manual", { shouldDirty: true });
                                     }
                                   }}
                                  onBlur={(event) => {
                                    field.onBlur();
                                     const value = Number(event.currentTarget.value.replace(/,/g, ""));
                                     if (!value) {
                                      form.setValue("grossCTCMode", "automatic", { shouldDirty: true });
                                       form.setValue("grossCTC", automaticGrossCTC, { shouldDirty: true, shouldValidate: true });
                                    }
                                  }}
                               />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="basicPay"
                        render={({ field }) => (
                          <FormItem>
                            <FormFieldHeader className="md:min-h-10">
                              <InfoLabel info="Enter monthly gross basic pay before PF, TDS, or any other deduction.">Basic Pay</InfoLabel>
                            </FormFieldHeader>
                            <FormControl>
                              <Input type="number" formatWithCommas className="text-secondary font-medium" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="hra"
                        render={({ field }) => (
                          <FormItem>
                             <InfoLabel info="Enter the gross monthly HRA shown under earnings, before deductions. HRA tax exemption is not inferred here.">HRA</InfoLabel>
                            <FormControl>
                              <Input type="number" formatWithCommas className="text-secondary font-medium" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="allowances"
                        render={({ field }) => (
                          <FormItem>
                             <InfoLabel info="Enter gross monthly taxable allowances before deductions. Do not enter take-home or net amounts.">Other Allowances</InfoLabel>
                            <FormControl>
                              <Input type="number" formatWithCommas className="text-secondary font-medium" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                   <div>
                     <div className="mb-3">
                       <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-sm font-semibold">Deductions (monthly)</h3>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button type="button" className="rounded-full text-muted-foreground hover:text-foreground" aria-label="About monthly deductions">
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-72 text-sm" side="top">
                                These amounts reduce take-home pay. They do not reduce the gross CTC entered above unless the tax rules explicitly allow a deduction.
                              </PopoverContent>
                            </Popover>
                          </div>
                       </div>
                     </div>
                     <div className="mb-4 grid grid-cols-1 gap-4 rounded-lg border border-dashed bg-background/70 p-3 sm:grid-cols-2">
                       <FormField
                         control={form.control}
                         name="financialYear"
                         render={({ field }) => (
                           <FormItem>
                              <InfoLabel info="The current Indian financial year is selected automatically from today’s date. Only years with versioned tax rules can be calculated; future rates are never guessed.">
                                Financial year
                              </InfoLabel>
                             <Select value={field.value} onValueChange={field.onChange}>
                               <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                               <SelectContent>
                                  {[...supportedFinancialYears].reverse().map((year) => (
                                    <SelectItem key={year} value={year}>FY {year.replace("-", "–")}</SelectItem>
                                  ))}
                                  {!supportedFinancialYears.includes(nextFinancialYear as FinancialYear) && (
                                    <SelectItem value={nextFinancialYear} disabled>
                                      FY {nextFinancialYear.replace("-", "–")} — rates pending
                                    </SelectItem>
                                  )}
                               </SelectContent>
                             </Select>
                           </FormItem>
                         )}
                       />
                       <FormField
                         control={form.control}
                         name="taxRegime"
                         render={({ field }) => (
                           <FormItem>
                              <InfoLabel info="Choose the regime used for this salary’s automatic TDS estimate. The Tax page compares the complete saved income picture.">
                                Tax regime
                              </InfoLabel>
                             <Select value={field.value} onValueChange={field.onChange}>
                               <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                               <SelectContent>
                                 <SelectItem value="new">New regime</SelectItem>
                                 <SelectItem value="old">Old regime</SelectItem>
                               </SelectContent>
                             </Select>
                           </FormItem>
                         )}
                       />
                     </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="employeePF"
                        render={({ field }) => (
                           <FormItem>
                             <FormFieldHeader className="md:min-h-12 md:items-center">
                               <InfoLabel info="Enter the monthly employee PF deduction. For recurring salary it is also synchronized to the linked EPF holding contribution.">
                                 Employee PF
                               </InfoLabel>
                             </FormFieldHeader>
                            <FormControl>
                              <Input type="number" formatWithCommas className="text-secondary font-medium" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="tds"
                        render={({ field }) => (
                           <FormItem>
                             <FormFieldHeader className="md:min-h-12 md:items-center">
                               <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                 <InfoLabel info={watchTdsMode === "automatic"
                                   ? "Estimated average monthly income-tax withholding based on this salary alone. Tax is deducted from take-home pay; it is not part of gross CTC."
                                   : "Enter the monthly tax actually withheld by the employer. Tax is deducted from take-home pay; it is not added to gross CTC."}>
                                   TDS (Tax)
                                 </InfoLabel>
                                  <span className="text-xs font-normal text-muted-foreground">(Auto-calculated if 0)</span>
                               </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs"
                                onClick={() => setIsTaxBreakdownOpen(true)}
                                aria-label="Open salary tax calculation"
                              >
                                <Calculator className="h-3.5 w-3.5" />
                                Breakdown
                              </Button>
                             </FormFieldHeader>
                            <FormControl>
                               <Input
                                 type="number"
                                 formatWithCommas
                                 className="font-medium text-secondary"
                                  {...field}
                                  onChange={(event) => {
                                    field.onChange(event);
                                     if (event.currentTarget.value.replace(/,/g, "").trim() !== "") {
                                      form.setValue("tdsMode", "manual", { shouldDirty: true });
                                    }
                                  }}
                                  onBlur={(event) => {
                                    field.onBlur();
                                     if (event.currentTarget.value.replace(/,/g, "").trim() === "") {
                                      form.setValue("tdsMode", "automatic", { shouldDirty: true });
                                      form.setValue("tds", Math.round(selectedSalaryTax.totalTax / 12), { shouldDirty: true, shouldValidate: true });
                                    }
                                  }}
                               />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="professionalTax"
                        render={({ field }) => (
                           <FormItem>
                             <FormFieldHeader className="md:min-h-7 md:items-center">
                               <InfoLabel info="Enter the monthly professional-tax deduction shown on the payslip.">Professional Tax</InfoLabel>
                             </FormFieldHeader>
                            <FormControl>
                              <Input type="number" formatWithCommas className="text-secondary font-medium" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="otherDeductions"
                        render={({ field }) => (
                           <FormItem>
                             <FormFieldHeader className="md:min-h-7 md:items-center">
                               <InfoLabel info="Enter other monthly payroll deductions not already captured above. Do not repeat PF, TDS, or professional tax.">
                                 Other Deductions
                               </InfoLabel>
                             </FormFieldHeader>
                            <FormControl>
                              <Input type="number" formatWithCommas className="text-secondary font-medium" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {previewSalary && (
                    <div className="bg-primary/5 p-4 rounded-lg border border-primary/10 mt-4">
                      <h3 className="text-sm font-semibold mb-2">Calculated Net Pay</h3>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground block">{watchFrequency === "Monthly" ? "Monthly Gross" : "Payment Gross"}</span>
                          <span className="font-semibold text-foreground">{formatINR(watchFrequency === "Monthly" ? previewSalary.monthlyGross : previewSalary.annualGross)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">{watchFrequency === "Monthly" ? "Monthly Net" : "Fund Net"}</span>
                          <span className="font-semibold text-foreground">
                            {formatINR(watchFrequency === "Monthly" ? previewSalary.monthlyNet : previewSalary.paymentNet)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Annual Gross</span>
                          <span className="font-semibold text-foreground">{formatINR(previewSalary.annualGross)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Effective Tax</span>
                          <span className="font-semibold text-foreground">{previewSalary.effectiveTaxRate.toFixed(2)}%</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!isOneTime && (
                <>
                <FormField
                  control={form.control}
                  name="annualGrowthRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Annual growth (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          max="50"
                          step="0.1"
                          placeholder="0"
                          className="text-secondary font-medium"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {watchFrequency === "Annual"
                          ? "Steps once per yearly occurrence; future grown amounts are estimates."
                          : "Applied as a yearly step on the anniversary of the growth effective date."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="rounded-lg border p-4 space-y-4">
                  <div>
                    <p className="text-sm font-semibold">Income availability</p>
                    <p className="text-xs text-muted-foreground">Choose the inclusive final month for this income. It defaults to retirement.</p>
                  </div>
                  <FormField
                    control={form.control}
                    name="incomeEndMode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>End income</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger data-testid="select-income-end-mode"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="retirement">At retirement</SelectItem>
                            <SelectItem value="custom">Custom date</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {watchIncomeEndMode === "custom" && (
                    <FormField
                      control={form.control}
                      name="incomeEndDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Last available month</FormLabel>
                          <FormControl>
                            <DatePickerInput value={field.value} onChange={field.onChange} minDate={new Date(1950, 0, 1)} />
                          </FormControl>
                          <FormDescription>The selected month is included in confirmed cash flow.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
                </>
              )}

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Any details..." className="text-secondary font-medium" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>

              <div className="shrink-0 pt-4 mt-4 border-t border-border flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "Saving..." : editingId ? "Save Changes" : "Add Income"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <Dialog open={isTaxBreakdownOpen} onOpenChange={setIsTaxBreakdownOpen}>
        <DialogContent className="max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Salary tax calculation</DialogTitle>
            <DialogDescription>
              FY {watchFinancialYear} estimate for this salary. It is educational planning information, not tax advice.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["new", "old"] as const).map((regime) => {
              const result = salaryTaxComparison[regime];
              return (
                <button
                  key={regime}
                  type="button"
                  onClick={() => form.setValue("taxRegime", regime, { shouldDirty: true })}
                  aria-pressed={watchTaxRegime === regime}
                  className={cn(
                    "rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    watchTaxRegime === regime ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/40",
                  )}
                >
                  <span className="text-sm font-semibold capitalize">{regime} regime</span>
                  <span className="mt-2 block text-2xl font-bold text-foreground">{formatINR(result.totalTax)}</span>
                  <span className="text-xs text-muted-foreground">{formatINR(Math.round(result.totalTax / 12))} average monthly TDS</span>
                </button>
              );
            })}
          </div>
          <div className="rounded-xl border">
            <dl className="divide-y px-4">
              {[
                ["Annualized salary", selectedSalaryTax.grossIncome],
                ["Standard deduction", -selectedSalaryTax.salaryStandardDeduction],
                ["Supported EPF / Chapter VI-A deduction", -selectedSalaryTax.chapterVIADeductions],
                ["Taxable income", selectedSalaryTax.taxableIncome],
                ["Tax from slabs", selectedSalaryTax.slabTax],
                ["Rebate and marginal relief", -(selectedSalaryTax.rebate + selectedSalaryTax.rebateMarginalRelief)],
                ["Surcharge", selectedSalaryTax.surcharge],
                ["Health & education cess", selectedSalaryTax.cess],
              ].map(([label, amount]) => (
                <div key={String(label)} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className={cn(
                    "font-medium tabular-nums",
                     label === "Annualized salary" ? "text-positive" : "text-foreground",
                  )}>{formatINR(Number(amount))}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 py-4 font-semibold">
                <dt>Annual liability</dt>
                <dd className="text-foreground tabular-nums">{formatINR(selectedSalaryTax.totalTax)}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Slab-by-slab</h3>
            <div className="space-y-2">
              {selectedSalaryTax.slabBreakdown.map((line) => (
                <div key={`${line.from}-${line.to ?? "up"}`} className="grid grid-cols-[1fr_auto] gap-4 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <span>
                    {formatINR(line.from)}–{line.to === null ? "and above" : formatINR(line.to)}
                    <span className="ml-2 text-muted-foreground">at {(line.rate * 100).toFixed(0)}%</span>
                  </span>
                    <span className="tabular-nums text-foreground">{formatINR(line.tax)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
            Net-pay preview uses {watchTdsMode === "manual" ? `your manual TDS of ${formatINR(Number(watchValues.tds) || 0)}` : `the automatic estimate of ${formatINR(Math.round(selectedSalaryTax.totalTax / 12))}`} per month.
            HRA exemption, rent declarations, employer benefits, special-rate income and deductions not recorded here are not inferred.
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setIsTaxBreakdownOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
