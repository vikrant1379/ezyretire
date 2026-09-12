import { useState, useMemo } from "react";
import {
  useLoans,
  useAddLoan,
  useUpdateLoan,
  useDeleteLoan
} from "@/hooks/use-loans";
import { useIncomeSources, calculateIncomeMetrics } from "@/hooks/use-income";
import { useExpenses } from "@/hooks/use-expenses";
import { useRetirementInputs } from "@/hooks/use-retirement";
import { formatCompactINR, formatINR } from "@/lib/utils";
import { isLivingExpense, loanMonthlyPayment, parseDateOnly } from "@/lib/storage";
import { financialHealthCompletionCallbacks } from "@/lib/financial-health-analytics";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@workspace/wealthone-design-system/components/ui/card";

function LoanMetricCurrency({ value }: { value: number }) {
  const exactValue = formatINR(value);

  return (
    <span className="financial-number" title={exactValue} aria-label={exactValue}>
      <span className="sm:hidden">{formatCompactINR(value)}</span>
      <span className="hidden sm:inline">{exactValue}</span>
    </span>
  );
}
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@workspace/wealthone-design-system/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormFieldHeader,
  FormItem,
  FormLabel,
  FormMessage
} from "@workspace/wealthone-design-system/components/ui/form";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@workspace/wealthone-design-system/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Plus,
  Landmark,
  Pencil,
  AlertTriangle,
  Calculator,
  MoreVertical,
  Trash2
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@workspace/wealthone-design-system/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@workspace/wealthone-design-system/components/ui/alert-dialog";
import {
  format,
  addMonths,
  isAfter,
  startOfMonth,
  endOfMonth,
  isWithinInterval,
  differenceInCalendarMonths
} from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@workspace/wealthone-design-system/components/ui/popover";
import { DatePickerInput } from "@workspace/wealthone-design-system/components/ui/date-picker-input";
import {
  isActiveLoan,
  type LoanType,
  type InterestType,
  type LoanRepaymentType,
  type Loan
} from "@/lib/storage";
import { loanPayoffDetails } from "@/lib/retirement-projection";
import {
  defaultUiPreferences,
  sortLoans,
  type LoanSortBy
} from "@/lib/card-order";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import {
  useUiPreferences,
  useUpdateUiPreferences
} from "@/hooks/use-ui-preferences";
import {
  SortableCard,
  SortableCardList
} from "@/components/sortable-card-list";
import { CardSortControls } from "@/components/card-sort-controls";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { DownloadExcelButton } from "@/components/download-excel-button";
import { buildLoanReportSheets } from "@/lib/excel-report-builders";
import { QueryErrorState } from "@/components/query-error-state";

const loanTypes: LoanType[] = [
  "Home",
  "Auto",
  "Personal",
  "Education",
  "Other"
];
const interestTypes: InterestType[] = ["Fixed", "Floating"];
const repaymentTypes: Array<{ value: LoanRepaymentType; label: string }> = [
  { value: "emi", label: "EMI (amortizing)" },
  { value: "bullet", label: "Bullet payment" },
  { value: "interest-only-plus-bullet", label: "Interest-only + principal bullet" },
];

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["Home", "Auto", "Personal", "Education", "Other"] as const),
  sanctionedPrincipal: z.coerce.number().min(0).default(0),
  outstandingPrincipal: z.coerce.number().min(0).default(0),
  annualInterestRate: z.coerce.number().min(0).default(0),
  interestType: z.enum(["Fixed", "Floating"] as const),
  totalTenureMonths: z.coerce.number().min(1).default(1),
  startDate: z.date(),
  emi: z.coerce.number().default(0),
  repaymentType: z.enum(["emi", "bullet", "interest-only-plus-bullet"] as const).default("emi"),
  prepayments: z.coerce.number().default(0),
  notes: z.string().optional()
});

type FormValues = z.infer<typeof formSchema>;

export default function Loans() {
  const loansQuery = useLoans();
  const incomesQuery = useIncomeSources();
  const expensesQuery = useExpenses();
  const retirementQuery = useRetirementInputs();
  const { data: loans = [], isLoading: loadingLoans } = loansQuery;
  const { data: incomes = [], isLoading: loadingIncome } = incomesQuery;
  const { data: expenses = [], isLoading: loadingExpenses } = expensesQuery;
  const { data: retirementInputs, isLoading: loadingRetirement } = retirementQuery;
  const { data: uiPreferences = defaultUiPreferences() } = useUiPreferences();
  const updatePreferences = useUpdateUiPreferences();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [loanToDelete, setLoanToDelete] = useState<Loan | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedLoanForAmort, setSelectedLoanForAmort] = useState<
    string | null
  >(null);
  const { toast } = useToast();

  const addLoan = useAddLoan();
  const updateLoan = useUpdateLoan();
  const deleteLoan = useDeleteLoan();
  const isSaving = addLoan.isPending || updateLoan.isPending;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "Home",
      sanctionedPrincipal: 0,
      outstandingPrincipal: 0,
      annualInterestRate: 0,
      interestType: "Fixed",
      totalTenureMonths: 12,
      startDate: new Date(),
      emi: 0,
      repaymentType: "emi",
      prepayments: 0,
      notes: ""
    }
  });

  const handleOpenDialog = (loan?: Loan) => {
    if (loan) {
      setEditingId(loan.id);
      form.reset({
        name: loan.name,
        type: loan.type,
        sanctionedPrincipal: loan.sanctionedPrincipal,
        outstandingPrincipal: loan.outstandingPrincipal,
        annualInterestRate: loan.annualInterestRate,
        interestType: loan.interestType,
        totalTenureMonths: loan.totalTenureMonths,
        startDate: parseDateOnly(loan.startDate),
        emi: loan.emi,
        repaymentType: loan.repaymentType ?? "emi",
        prepayments: loan.prepayments,
        notes: loan.notes || ""
      });
    } else {
      setEditingId(null);
      form.reset({
        name: "",
        type: "Home",
        sanctionedPrincipal: 0,
        outstandingPrincipal: 0,
        annualInterestRate: 8.5,
        interestType: "Floating",
        totalTenureMonths: 240,
        startDate: new Date(),
        emi: 0,
        repaymentType: "emi",
        prepayments: 0,
        notes: ""
      });
    }
    setIsDialogOpen(true);
  };

  const onSubmit = (data: FormValues) => {
    if (isSaving) return;

    let out = data.outstandingPrincipal;
    if (!editingId && out === 0) {
      out = data.sanctionedPrincipal;
    }

    let emi = data.emi;
    if (data.repaymentType === "bullet") {
      emi = 0;
    } else if (data.repaymentType === "interest-only-plus-bullet") {
      emi = Math.round(out * data.annualInterestRate / 1200);
    } else if (!emi || emi === 0) {
      const p = data.sanctionedPrincipal;
      const r = data.annualInterestRate / 12 / 100;
      const n = data.totalTenureMonths;
      if (r > 0) {
        emi = Math.round(
          (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
        );
      } else {
        emi = Math.round(p / n);
      }
    }

    const payload = { 
      ...data, 
      emi, 
      outstandingPrincipal: out,
      startDate: format(data.startDate, "yyyy-MM-dd")
    };

    if (editingId) {
      updateLoan.mutate(
        {
          ...payload,
          id: editingId,
          createdAt: loans.find((l) => l.id === editingId)!.createdAt
        },
        financialHealthCompletionCallbacks("loans", "updated", () => {
            setIsDialogOpen(false);
            toast({ title: "Loan updated" });
        })
      );
    } else {
      addLoan.mutate(payload, financialHealthCompletionCallbacks("loans", "created", () => {
          setIsDialogOpen(false);
          toast({ title: "Loan added" });
      }));
    }
  };

  const metrics = useMemo(() => {
    let totalOutstanding = 0;
    let totalEMI = 0;
    let totalInterest = 0;
    let debtFreeMonths = 0;

    const activeLoans = loans.filter((loan) => isActiveLoan(loan));
    activeLoans.forEach((l) => {
      totalOutstanding += l.outstandingPrincipal;
      totalEMI += loanMonthlyPayment(l);
    });
    const overviewLoans = loans.filter((loan) => Number(loan.outstandingPrincipal) > 0);
    totalOutstanding = overviewLoans.reduce(
      (sum, loan) => sum + Math.max(0, loan.outstandingPrincipal),
      0,
    );
    overviewLoans.forEach((l) => {
      const payoff = loanPayoffDetails(l);
      totalInterest += payoff.totalInterestLeft;
      const startDelay = Math.max(0, differenceInCalendarMonths(parseDateOnly(l.startDate), new Date()));
      debtFreeMonths = Math.max(debtFreeMonths, startDelay + payoff.remainingMonths);
    });

    const totalIncome = incomes.reduce(
      (sum, s) => sum + calculateIncomeMetrics(s).monthlyNet,
      0
    );
    const dti = totalIncome > 0 ? (totalEMI / totalIncome) * 100 : 0;

    const currentMonthStart = startOfMonth(new Date());
    const currentMonthEnd = endOfMonth(new Date());
    const currentOrdinaryExpenses = expenses
      .filter(
        (e) =>
          isWithinInterval(new Date(e.date), {
            start: currentMonthStart,
            end: currentMonthEnd
          }) &&
          isLivingExpense(e, loans)
      )
      .reduce((sum, e) => sum + e.amount, 0);

    const totalOutflow = currentOrdinaryExpenses + totalEMI;

    // Retirement warning logic
    let retirementDate: Date | null = null;
    if (retirementInputs) {
      const dob = parseDateOnly(retirementInputs.dateOfBirth);
      retirementDate = new Date(
        dob.getFullYear() + retirementInputs.targetRetirementAge,
        dob.getMonth(),
        dob.getDate()
      );
    }

    return {
      totalOutstanding,
      totalEMI,
      totalIncome,
      dti,
      currentOrdinaryExpenses,
      totalOutflow,
      retirementDate,
      activeLoanCount: activeLoans.length,
      overviewLoanCount: overviewLoans.length
      ,totalInterest
      ,debtFreeMonths
    };
  }, [loans, incomes, expenses, retirementInputs]);

  const listedLoans = useMemo(
    () => sortLoans(loans, uiPreferences),
    [loans, uiPreferences]
  );
  const manualOrder = uiPreferences.loanSort.by === "manual";

  if (loadingLoans || loadingIncome || loadingExpenses || loadingRetirement) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-primary/20 rounded-full mb-4"></div>
          <p className="text-muted-foreground">Loading liabilities...</p>
        </div>
      </div>
    );
  }

  if (loansQuery.isError || incomesQuery.isError || expensesQuery.isError || retirementQuery.isError) {
    return <QueryErrorState onRetry={() => loansQuery.refetch()} />;
  }

  const loanExportSheets = buildLoanReportSheets(listedLoans, {
    retirementDate: metrics.retirementDate,
  });

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-8 md:pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif text-primary">
            Loans & Liabilities
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Manage your debt, track EMIs, and simulate prepayments.
          </p>
        </div>
        <div className="flex w-full items-center justify-end gap-2 md:w-auto">
          <Button onClick={() => handleOpenDialog()} className="flex-1 shadow-sm md:flex-none">
            <Plus className="h-4 w-4 mr-2" /> Add Loan
          </Button>
          <DownloadExcelButton
            sheets={loanExportSheets}
            reportSlug="loans_report"
            size="sm"
            className="max-w-full text-xs"
            mobileDirectDownload
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-px md:grid-cols-4 md:gap-4">
        <Card className="min-w-0 border-0 shadow-md bg-card">
          <CardContent className="space-y-3 p-4 pt-4 md:p-5 md:pt-5">
            <div className="space-y-1">
              <CardDescription className="font-medium text-tiny uppercase tracking-wider md:text-xs">
                Total Outstanding
              </CardDescription>
              <CardTitle className={cn(
                "w-full text-lg font-sans font-bold sm:text-xl xl:text-2xl",
                metrics.totalOutstanding > 0 ? "text-negative" : "text-foreground",
              )}>
                <LoanMetricCurrency value={metrics.totalOutstanding} />
              </CardTitle>
            </div>
            <div className="flex items-center text-xs md:text-sm">
              <span className="text-muted-foreground">
                Across {metrics.activeLoanCount} active loans
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-0 shadow-md bg-card">
          <CardContent className="space-y-3 p-4 pt-4 md:p-5 md:pt-5">
            <div className="space-y-1">
              <CardDescription className="font-medium text-tiny uppercase tracking-wider md:text-xs">
                Monthly EMI Burden
              </CardDescription>
              <CardTitle className="w-full text-lg font-sans font-bold text-foreground sm:text-xl xl:text-2xl">
                <LoanMetricCurrency value={metrics.totalEMI} />
              </CardTitle>
            </div>
            <div className="flex items-center text-xs md:text-sm">
              <span className="text-muted-foreground">
                Fixed monthly outflow
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-0 shadow-md bg-card">
          <CardContent className="space-y-3 p-4 pt-4 md:p-5 md:pt-5">
            <div className="space-y-1">
              <CardDescription className="font-medium text-tiny uppercase tracking-wider md:text-xs">
                Debt-to-Income
              </CardDescription>
              <CardTitle
                className={cn(
                  "financial-number w-full text-lg font-sans font-bold text-foreground sm:text-xl xl:text-2xl",
                )}
              >
                {metrics.dti.toFixed(2)}%
              </CardTitle>
            </div>
            <div className="flex items-center text-xs md:text-sm truncate">
              <span className="text-muted-foreground truncate">
                 Of <span className="text-positive"><LoanMetricCurrency value={metrics.totalIncome} /></span> net income
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-0 shadow-md bg-card">
          <CardContent className="space-y-3 p-4 pt-4 md:p-5 md:pt-5">
            <div className="space-y-1">
              <CardDescription className="font-medium text-tiny uppercase tracking-wider text-muted-foreground md:text-xs">
                Monthly Outflow
              </CardDescription>
              <CardTitle className="w-full text-lg font-sans font-bold text-foreground sm:text-xl xl:text-2xl">
                <LoanMetricCurrency value={metrics.totalOutflow} />
              </CardTitle>
            </div>
            <p className="text-xs md:text-sm text-muted-foreground">
              Expenses + EMIs
            </p>
          </CardContent>
        </Card>
      </div>

      {metrics.overviewLoanCount > 0 && (
        <Card className="border-0 bg-card shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-serif">All-loans debt-free overview</CardTitle>
            <CardDescription>Combined payoff timeline and retirement impact.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div><p className="text-muted-foreground">Debt-free date</p><p className="font-semibold">{format(addMonths(new Date(), metrics.debtFreeMonths), "MMM yyyy")}</p></div>
            <div><p className="text-muted-foreground">Future interest</p><p className="font-semibold text-foreground">{formatINR(metrics.totalInterest)}</p></div>
            <div><p className="text-muted-foreground">Combined burden</p><p className="font-semibold text-foreground">{formatINR(metrics.totalEMI)}/mo</p></div>
            <div><p className="text-muted-foreground">Retirement overlap</p><p className="font-semibold">{metrics.retirementDate && isAfter(addMonths(new Date(), metrics.debtFreeMonths), metrics.retirementDate) ? "Yes — review payoff plan" : "None projected"}</p></div>
          </CardContent>
          <CardContent className="pt-0">
            <h3 className="mb-2 text-sm font-semibold">Debt payoff timeline</h3>
            <ol className="space-y-2 border-l-2 border-primary/20 pl-4" aria-label="All loan payoff timeline">
              {loans.filter((loan) => Number(loan.outstandingPrincipal) > 0).sort((a, b) => {
                const aEnd = differenceInCalendarMonths(parseDateOnly(a.startDate), new Date()) + loanPayoffDetails(a).remainingMonths;
                const bEnd = differenceInCalendarMonths(parseDateOnly(b.startDate), new Date()) + loanPayoffDetails(b).remainingMonths;
                return aEnd - bEnd;
              }).map((loan) => {
                const delay = Math.max(0, differenceInCalendarMonths(parseDateOnly(loan.startDate), new Date()));
                const payoff = loanPayoffDetails(loan);
                const payoffDate = addMonths(new Date(), delay + payoff.remainingMonths);
                return <li key={loan.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 p-2.5 text-sm"><span className="font-medium">{loan.name} · {loan.repaymentType === "bullet" ? "bullet maturity" : "payoff"}</span><span>{format(payoffDate, "MMM yyyy")} · {formatINR(payoff.totalInterestLeft)} interest</span></li>;
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <Card className="border-0 shadow-sm bg-card lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 p-4 md:p-6">
            <div className="flex w-full items-start justify-between gap-3">
              <CardTitle className="min-w-0 pt-2 text-base font-serif md:text-lg sm:pt-1">Your Loans</CardTitle>
              {loans.length > 1 ? (
                <CardSortControls
                  value={uiPreferences.loanSort.by}
                  direction={uiPreferences.loanSort.direction}
                  options={
                    [
                      { value: "manual", label: "Custom Order" },
                      { value: "outstanding", label: "Outstanding" },
                      { value: "emi", label: "EMI" },
                      { value: "remaining", label: "Remaining Time" },
                      { value: "interest", label: "Future Interest" }
                    ] satisfies { value: LoanSortBy; label: string }[]
                  }
                  onByChange={(by) =>
                    updatePreferences.mutate({
                      loanSort: { ...uiPreferences.loanSort, by }
                    })
                  }
                  onDirectionChange={(direction) =>
                    updatePreferences.mutate({
                      loanSort: { ...uiPreferences.loanSort, direction }
                    })
                  }
                  compactOnMobile
                  className="shrink-0"
                />
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {listedLoans.length > 0 ? (
              <SortableCardList
                ids={listedLoans.map((item) => item.id)}
                enabled={manualOrder}
                onReorder={(loanOrder) =>
                  updatePreferences.mutate({ loanOrder })
                }
              >
                {listedLoans.map((loan) => {
                  const r = loan.annualInterestRate / 12 / 100;
                  const payoff = loanPayoffDetails(loan);
                  const p = payoff.remainingPrincipal;
                  const emi = loanMonthlyPayment(loan);
                  const { remainingMonths, totalInterestLeft } = payoff;

                  const startDelay = Math.max(0, differenceInCalendarMonths(parseDateOnly(loan.startDate), new Date()));
                  const endDate = addMonths(new Date(), startDelay + remainingMonths);
                  const overlapsRetirement =
                    metrics.retirementDate &&
                    isAfter(endDate, metrics.retirementDate);
                    
                  const isFuture = loan.startDate && parseDateOnly(loan.startDate) > new Date();
                  const isCompleted = p <= 0;
                  const status = isCompleted ? "Completed" : isFuture ? "Planned" : "Active";
                  const displayOutstanding = isFuture && loan.outstandingPrincipal === 0 ? loan.sanctionedPrincipal : loan.outstandingPrincipal;

                  return (
                    <SortableCard
                      key={loan.id}
                      id={loan.id}
                      enabled={manualOrder}
                    >
                      <div className="flex flex-col gap-3 pr-10 md:pr-0 sm:flex-row sm:justify-between sm:items-start">
                        <div className="flex min-w-0 items-start gap-4">
                          <div className={cn(
                            "h-10 w-10 shrink-0 rounded-full flex items-center justify-center mt-1",
                            "bg-muted text-muted-foreground"
                          )}>
                            <Landmark className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <p className="min-w-0 break-words font-semibold text-base">
                                {loan.name}
                              </p>
                              <span className={cn(
                                "text-tiny font-semibold px-2 py-0.5 rounded-full",
                                "bg-muted text-muted-foreground"
                              )}>
                                {status}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {loan.type} • {loan.annualInterestRate}%{" "}
                              {loan.interestType}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {repaymentTypes.find((type) => type.value === (loan.repaymentType ?? "emi"))?.label}
                            </p>
                            {status === "Planned" && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Starts {format(parseDateOnly(loan.startDate), "MMM yyyy")}
                              </p>
                            )}
                            {overlapsRetirement && status !== "Completed" && (
                              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground font-medium">
                                <AlertTriangle className="h-3 w-3" />
                                Loan continues into retirement
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="absolute right-3 top-3 md:hidden">
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 rounded-full"
                                aria-label={`Actions for ${loan.name}`}
                              >
                                <MoreVertical className="h-5 w-5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              sideOffset={6}
                              className="min-w-44"
                            >
                              <DropdownMenuItem
                                className="gap-2 rounded-lg px-3 py-2 text-sm"
                                onSelect={() =>
                                  setSelectedLoanForAmort(
                                    selectedLoanForAmort === loan.id ? null : loan.id
                                  )
                                }
                              >
                                <Calculator className="h-4 w-4 text-muted-foreground" />
                                {selectedLoanForAmort === loan.id ? "Hide breakdown" : "View breakdown"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2 rounded-lg px-3 py-2 text-sm"
                                onSelect={() => handleOpenDialog(loan)}
                              >
                                <Pencil className="h-4 w-4 text-muted-foreground" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => setLoanToDelete(loan)}
                                className="gap-2 rounded-lg px-3 py-2 text-sm text-destructive focus:bg-destructive/10 focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <div className="hidden shrink-0 items-center gap-2 md:flex">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setSelectedLoanForAmort(
                                selectedLoanForAmort === loan.id
                                  ? null
                                  : loan.id
                              )
                            }
                             aria-label={`${selectedLoanForAmort === loan.id ? "Hide" : "Show"} amortization for ${loan.name}`}
                          >
                            <Calculator className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenDialog(loan)}
                             aria-label={`Edit ${loan.name} loan`}
                          >
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <ConfirmDeleteButton
                            itemName={loan.name}
                            entityLabel="loan"
                            onConfirm={() => {
                              deleteLoan.mutate(loan.id, {
                                onSuccess: () =>
                                  toast({ title: "Loan deleted" })
                              });
                            }}
                          />
                        </div>
                      </div>

                      <div className="grid min-w-0 grid-cols-2 md:grid-cols-4 gap-4 mt-2 pt-4 border-t border-border/50 text-sm">
                        <div className="min-w-0">
                          <p className="text-muted-foreground mb-1">
                            {isFuture ? "Planned Amount" : "Outstanding"}
                          </p>
                          <p className={cn(
                            "[overflow-wrap:anywhere] font-semibold",
                            displayOutstanding > 0 ? "text-negative" : "text-foreground",
                          )}>
                            {formatINR(displayOutstanding)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-muted-foreground mb-1">{loan.repaymentType === "bullet" ? "Monthly burden" : isFuture ? "Planned monthly burden" : "Monthly burden"}</p>
                          <p className={cn(
                            "[overflow-wrap:anywhere] font-semibold",
                            "text-foreground"
                          )}>
                            {formatINR(loanMonthlyPayment(loan))}
                          </p>
                        </div>
                        {loan.repaymentType === "bullet" && (
                          <div className="col-span-2 min-w-0 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground md:col-span-4">
                            Bullet maturity obligation: {formatINR(p + totalInterestLeft)} due around {format(endDate, "MMM yyyy")}.
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-muted-foreground mb-1">
                            {isFuture ? "Total Tenure" : "Remaining Time"}
                          </p>
                          <p className="[overflow-wrap:anywhere] font-semibold">
                            {Math.floor(remainingMonths / 12)}y{" "}
                            {remainingMonths % 12}m
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-muted-foreground mb-1">
                            Future Interest
                          </p>
                          <p className="[overflow-wrap:anywhere] font-semibold text-foreground">
                            {formatINR(totalInterestLeft)}
                          </p>
                        </div>
                      </div>

                      {selectedLoanForAmort === loan.id && (
                        <div className="mt-4 p-4 bg-muted/30 rounded-lg border border-border">
                          <h4 className="font-serif text-sm font-semibold mb-3 flex items-center justify-between">
                            <span>Prepayment Simulator</span>
                            <span className="font-sans font-normal text-xs text-muted-foreground">
                              Est. time remaining: {remainingMonths} months
                            </span>
                          </h4>
                          <p className="text-xs text-muted-foreground mb-4">
                            Extra monthly principal payments reduce the balance and future interest for this repayment structure.
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {[1000, 5000, 10000].map((extra) => {
                              const newEmi = emi + extra;
                              let newRemainingMonths = 0;
                              let newInterestLeft = 0;
                              if ((loan.repaymentType ?? "emi") !== "emi") {
                                let balance = p;
                                while (balance > 0.005 && newRemainingMonths < remainingMonths) {
                                  newInterestLeft += balance * r;
                                  balance = Math.max(0, balance - extra);
                                  newRemainingMonths += 1;
                                }
                              } else if (r > 0 && newEmi > p * r) {
                                newRemainingMonths = Math.ceil(
                                  Math.log(newEmi / (newEmi - p * r)) /
                                    Math.log(1 + r)
                                );
                                newInterestLeft =
                                  newRemainingMonths * newEmi - p;
                              }

                              const monthsSaved =
                                remainingMonths - newRemainingMonths;
                              const interestSaved =
                                totalInterestLeft - newInterestLeft;

                              return (
                                <div
                                  key={extra}
                                  className="p-3 bg-card border border-border rounded-lg flex flex-col gap-1"
                                >
                                  <div className="text-xs font-semibold text-muted-foreground">
                                    +<span className="text-foreground">{formatINR(extra)}</span>/mo principal
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Save{" "}
                                    <span className="text-foreground font-medium">
                                      {monthsSaved} mo
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Save{" "}
                                    <span className="text-positive font-medium">
                                      {formatINR(interestSaved)}
                                    </span>{" "}
                                    in int.
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </SortableCard>
                  );
                })}
              </SortableCardList>
            ) : (
              <div className="w-full py-16 flex flex-col items-center text-muted-foreground border border-dashed rounded-xl">
                <Landmark className="h-12 w-12 mb-3 opacity-20" />
                <p>No loans recorded.</p>
                <Button
                  variant="link"
                  onClick={() => handleOpenDialog()}
                  className="mt-2 text-primary"
                >
                  Track a liability
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-card h-fit">
          <CardHeader className="p-4 md:p-6 md:pb-4">
            <CardTitle className="text-base md:text-lg font-serif">
              Outflow Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Living Expenses</span>
                  <span className="font-semibold">
                    <span className="text-foreground">{formatINR(metrics.currentOrdinaryExpenses)}</span>
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: `${(metrics.currentOrdinaryExpenses / Math.max(metrics.totalOutflow, 1)) * 100}%`
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Loan EMIs</span>
                  <span className="font-semibold text-foreground">
                    {formatINR(metrics.totalEMI)}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-destructive"
                    style={{
                      width: `${(metrics.totalEMI / Math.max(metrics.totalOutflow, 1)) * 100}%`
                    }}
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                 <div className="flex justify-between font-semibold">
                  <span>Monthly Outflow</span>
                   <span className="text-foreground">{formatINR(metrics.totalOutflow)}</span>
                </div>
                <div className="flex justify-between text-sm mt-2 text-muted-foreground">
                  <span>True Savings Rate</span>
                  <span
                     className="font-medium text-foreground"
                  >
                    {metrics.totalIncome > 0
                      ? (
                          ((metrics.totalIncome - metrics.totalOutflow) /
                            metrics.totalIncome) *
                          100
                        ).toFixed(2)
                      : 0}
                    %
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={Boolean(loanToDelete)}
        onOpenChange={(open) => {
          if (!open) setLoanToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {loanToDelete?.name || "this loan"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this loan. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!loanToDelete) return;
                deleteLoan.mutate(loanToDelete.id, {
                  onSuccess: () => {
                    toast({ title: "Loan deleted" });
                    setLoanToDelete(null);
                  }
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
        <DialogContent className="w-[calc(100%-2rem)] max-w-2xl rounded-xl p-6 flex flex-col gap-0">
          <DialogHeader className="shrink-0 pb-4">
            <DialogTitle>{editingId ? "Edit Loan" : "Add Loan"}</DialogTitle>
            <DialogDescription>
              Enter the details of your liability. Input fields are highlighted
              in blue. Formula outputs are black.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-1 space-y-4 md:space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="repaymentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Repayment type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {repaymentTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Loan Name / Lender</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. HDFC Home Loan"
                          className="text-secondary font-medium"
                          {...field}
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
                      <FormLabel>Loan Type</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="text-secondary font-medium">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {loanTypes.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="sanctionedPrincipal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sanctioned Principal (₹)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          formatWithCommas
                          className="text-secondary font-medium"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="outstandingPrincipal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Outstanding Principal (₹)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          formatWithCommas
                          className="text-secondary font-medium"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="annualInterestRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Interest Rate (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          className="text-secondary font-medium"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="interestType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rate Type</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="text-secondary font-medium">
                            <SelectValue placeholder="Type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {interestTypes.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="totalTenureMonths"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total Tenure (Months)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          className="text-secondary font-medium"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="emi"
                  render={({ field }) => (
                    <FormItem>
                      <FormFieldHeader className="md:min-h-10">
                        <FormLabel>
                          Scheduled monthly payment (₹){" "}
                          <span className="text-muted-foreground text-xs font-normal">
                            (Auto-calculated if 0)
                          </span>
                        </FormLabel>
                      </FormFieldHeader>
                      <FormControl>
                        <Input
                          type="number"
                          formatWithCommas
                          className="text-secondary font-medium"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormFieldHeader className="md:min-h-10">
                        <FormLabel>Loan Start Date</FormLabel>
                      </FormFieldHeader>
                      <FormControl>
                        <DatePickerInput
                          value={field.value}
                          onChange={field.onChange}
                          minDate={new Date(1950, 0, 1)}
                          maxDate={
                            new Date(new Date().getFullYear() + 20, 11, 31)
                          }
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground mt-1">
                        Select a future date for a planned loan. Future loans won't affect today's EMI burden.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              </div>

              <div className="shrink-0 pt-4 mt-4 border-t border-border">
                <Button type="submit" className="w-full" disabled={isSaving}>
                  {isSaving
                    ? "Saving..."
                    : editingId
                      ? "Save Changes"
                      : "Add Loan"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
