import { useState, useMemo } from "react";
import {
  useInvestments,
  useAddInvestment,
  useUpdateInvestment,
  useDeleteInvestment
} from "@/hooks/use-investments";
import { useRetirementInputs } from "@/hooks/use-retirement";
import { useIncomeSources } from "@/hooks/use-income";
import { useExpenses } from "@/hooks/use-expenses";
import { useBudgets } from "@/hooks/use-budgets";
import { useLoans } from "@/hooks/use-loans";
import {
  allocationOpportunityAmount,
  calculateRetirementProjection,
  investmentProjectedValue,
  portfolioAllocationPercent,
  validatedFundAllocations,
} from "@/lib/retirement-projection";
import {
  defaultUiPreferences,
  sortInvestments,
  type InvestmentSortBy
} from "@/lib/card-order";
import { formatCompactINR, formatINR } from "@/lib/utils";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@workspace/wealthone-design-system/components/ui/card";

function InvestmentMetricCurrency({
  value,
  prefix = "",
}: {
  value: number;
  prefix?: string;
}) {
  const exactValue = `${prefix}${formatINR(value)}`;

  return (
    <span className="financial-number" title={exactValue} aria-label={exactValue}>
      <span className="lg:hidden">{prefix}{formatCompactINR(value)}</span>
      <span className="hidden lg:inline">{exactValue}</span>
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/wealthone-design-system/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/wealthone-design-system/components/ui/dropdown-menu";
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
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Plus,
  PiggyBank,
  Pencil,
  PieChart as PieChartIcon,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  MessageSquareHeart,
  ChevronDown,
  Trash2,
  Undo2,
  MoreVertical
} from "lucide-react";
import { DatePickerInput } from "@workspace/wealthone-design-system/components/ui/date-picker-input";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip
} from "recharts";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import type { FundAllocation } from "@/lib/storage";
import { formatDateOnly, isRecurringIncomeActive, parseDateOnly, type AssetClass, type Investment } from "@/lib/storage";
import type { DatedFundOpportunity } from "@/lib/retirement-projection";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { Textarea } from "@workspace/wealthone-design-system/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@workspace/wealthone-design-system/components/ui/collapsible";
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
import { DisposalImportButton } from "@/components/disposal-import-button";
import { disposalImportBatchIndexes } from "@/lib/disposal-import";
import { buildInvestmentReportSheets } from "@/lib/excel-report-builders";
import { QueryErrorState } from "@/components/query-error-state";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const assetClasses: AssetClass[] = [
  "Direct Equity",
  "Mutual Funds",
  "Fixed Deposit",
  "Recurring Deposit",
  "PPF",
  "EPF",
  "NPS",
  "Gold",
  "Real Estate",
  "Bonds",
  "Crypto",
  "ESOP",
  "Other"
];

const getDefaultReturn = (assetClass: AssetClass): number => {
  switch (assetClass) {
    case "Direct Equity":
      return 13;
    case "Mutual Funds":
      return 12;
    case "Fixed Deposit":
      return 7;
    case "Recurring Deposit":
      return 6.5;
    case "PPF":
      return 7.1;
    case "EPF":
      return 8.15;
    case "NPS":
      return 10;
    case "Gold":
      return 6;
    case "Real Estate":
      return 6;
    case "Bonds":
      return 8;
    default:
      return 0;
  }
};

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  assetClass: z.enum([
    "Direct Equity",
    "Mutual Funds",
    "Fixed Deposit",
    "Recurring Deposit",
    "PPF",
    "EPF",
    "NPS",
    "Gold",
    "Real Estate",
    "Bonds",
    "Crypto",
    "ESOP",
    "Other"
  ] as const),
  investedAmount: z.coerce.number().min(0).default(0),
  currentValue: z.coerce.number().min(0).default(0),
  quantity: z.coerce.number().optional(),
  averageBuyPrice: z.coerce.number().optional(),
  monthlyContribution: z.coerce.number().min(0).default(0),
  contributionStartDate: z.string().optional(),
  contributionEndMode: z.enum(["retirement", "custom"]).default("retirement"),
  contributionEndDate: z.string().optional(),
  expectedReturn: z.coerce.number().default(0),
  ticker: z.string().optional(),
  folio: z.string().optional(),
  institution: z.string().optional(),
  interestRate: z.coerce.number().optional(),
  accountNumber: z.string().optional(),
  unit: z.string().optional(),
  location: z.string().optional(),
  area: z.string().optional(),
  maturityDate: z.string().optional(),
  notes: z.string().optional(),
  disposals: z.array(z.object({
    id: z.string(),
    name: z.string().min(1, "Sale description is required"),
    purchaseDate: z.string().min(1, "Purchase date is required"),
    saleDate: z.string().min(1, "Sale date is required"),
    costBasis: z.coerce.number().min(0, "Cost basis cannot be negative"),
    proceeds: z.coerce.number().min(0, "Proceeds cannot be negative"),
    assetType: z.string().min(1, "Asset type is required"),
    eligibleExemption: z.coerce.number().min(0, "Eligible exemption cannot be negative"),
    indexedCostBasis: z.union([z.literal(""), z.coerce.number().min(0, "Indexed cost cannot be negative")]).optional(),
    grandfatheredValue: z.union([z.literal(""), z.coerce.number().min(0, "Grandfathered value cannot be negative")]).optional(),
    importBatchId: z.string().optional(),
    importedAt: z.string().optional(),
    createdAt: z.string(),
  }).refine(
    (disposal) => !disposal.purchaseDate
      || !disposal.saleDate
      || parseDateOnly(disposal.saleDate) >= parseDateOnly(disposal.purchaseDate),
    {
      message: "Sale date must be on or after purchase date",
      path: ["saleDate"],
    },
  )).default([])
}).refine(data => {
  if (data.contributionEndMode === "custom" && !data.contributionEndDate) {
    return false;
  }
  return true;
}, {
  message: "End date is required for custom schedule",
  path: ["contributionEndDate"]
}).refine(data => {
  if (data.contributionStartDate && data.contributionEndDate && data.contributionEndMode === "custom") {
    if (new Date(data.contributionStartDate) > new Date(data.contributionEndDate)) {
      return false;
    }
  }
  return true;
}, {
  message: "End date must not be before start date",
  path: ["contributionEndDate"]
});

type FormValues = z.infer<typeof formSchema>;

export default function Investments() {
  const investmentsQuery = useInvestments();
  const retirementQuery = useRetirementInputs();
  const incomesQuery = useIncomeSources();
  const expensesQuery = useExpenses();
  const budgetsQuery = useBudgets();
  const loansQuery = useLoans();
  const { data: investments = [], isLoading: loadingInv } = investmentsQuery;
  const { data: retirementInputs, isLoading: loadingRet } = retirementQuery;
  const { data: incomes = [], isLoading: loadingInc } = incomesQuery;
  const { data: expenses = [], isLoading: loadingExp } = expensesQuery;
  const { data: budgets = [], isLoading: loadingBud } = budgetsQuery;
  const { data: loans = [], isLoading: loadingLoans } = loansQuery;
  const { data: uiPreferences = defaultUiPreferences() } = useUiPreferences();
  const updatePreferences = useUpdateUiPreferences();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingInvestment, setDeletingInvestment] = useState<Investment | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isGapAnalysisOpen, setIsGapAnalysisOpen] = useState(false);
  const [isYearlyOutlookOpen, setIsYearlyOutlookOpen] = useState(false);
  const [allocatingFund, setAllocatingFund] = useState<DatedFundOpportunity | null>(null);
  const [allocationAmount, setAllocationAmount] = useState("");
  const [allocationDate, setAllocationDate] = useState("");
  const [allocationTarget, setAllocationTarget] = useState("new");
  const [allocationName, setAllocationName] = useState("");
  const [allocationAssetClass, setAllocationAssetClass] = useState<AssetClass>("Mutual Funds");
  const [editingAllocation, setEditingAllocation] = useState<{
    investment: Investment;
    allocation: FundAllocation;
  } | null>(null);
  const [editingAllocationAmount, setEditingAllocationAmount] = useState("");
  const [editingAllocationDate, setEditingAllocationDate] = useState("");
  const { toast } = useToast();
  
  const asOf = useMemo(() => new Date(), []);
  const validFundAllocations = useMemo(
    () => validatedFundAllocations(
      investments,
      incomes,
      retirementInputs?.salaryGrowth ?? 0,
    ),
    [investments, incomes, retirementInputs?.salaryGrowth],
  );

  const addInvestment = useAddInvestment();
  const updateInvestment = useUpdateInvestment();
  const deleteInvestment = useDeleteInvestment();
  const isSaving = addInvestment.isPending || updateInvestment.isPending;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      assetClass: "Mutual Funds",
      investedAmount: 0,
      currentValue: 0,
      quantity: 0,
      averageBuyPrice: 0,
      monthlyContribution: 0,
      expectedReturn: 12,
      notes: "",
      disposals: [],
    }
  });
  const disposalFields = useFieldArray({
    control: form.control,
    name: "disposals",
  });
  const currentDisposals = form.watch("disposals");
  const importBatches = useMemo(() => {
    const batches = new Map<string, { importedAt?: string; indexes: number[] }>();
    currentDisposals.forEach((disposal, index) => {
      if (!disposal.importBatchId) return;
      const batch = batches.get(disposal.importBatchId) ?? {
        importedAt: disposal.importedAt,
        indexes: [],
      };
      batch.indexes.push(index);
      batches.set(disposal.importBatchId, batch);
    });
    return Array.from(batches, ([id, details]) => ({ id, ...details }));
  }, [currentDisposals]);
  const selectedAssetClass = form.watch("assetClass");
  const editingInvestment = editingId
    ? investments.find((investment) => investment.id === editingId)
    : undefined;
  const isLinkedEPF = Boolean(
    editingInvestment?.autoManagedContribution &&
    editingInvestment.linkedIncomeSourceId
  );

  const handleOpenDialog = (inv?: Investment) => {
    if (inv) {
      setEditingId(inv.id);
      form.reset({
        name: inv.name,
        assetClass: inv.assetClass,
        investedAmount: inv.investedAmount,
        currentValue: inv.currentValue,
        quantity: inv.quantity || 0,
        averageBuyPrice: inv.averageBuyPrice || 0,
        monthlyContribution: inv.monthlyContribution || 0,
        contributionStartDate: inv.contributionStartDate || "",
        contributionEndMode: inv.contributionEndMode || "retirement",
        contributionEndDate: inv.contributionEndDate || "",
        expectedReturn: inv.expectedReturn,
        ticker: inv.ticker || "",
        folio: inv.folio || "",
        institution: inv.institution || "",
        interestRate: inv.interestRate,
        accountNumber: inv.accountNumber || "",
        unit: inv.unit || "",
        location: inv.location || "",
        area: inv.area || "",
        maturityDate: inv.maturityDate?.slice(0, 10) || "",
        notes: inv.notes || "",
        disposals: (inv.disposals ?? []).map((disposal) => ({
          ...disposal,
          name: disposal.name ?? "",
          purchaseDate: disposal.purchaseDate ?? "",
          saleDate: disposal.saleDate ?? "",
          costBasis: disposal.costBasis ?? 0,
          proceeds: disposal.proceeds ?? 0,
          assetType: disposal.assetType ?? "",
          eligibleExemption: disposal.eligibleExemption ?? 0,
          indexedCostBasis: disposal.indexedCostBasis ?? "",
          grandfatheredValue: disposal.grandfatheredValue ?? "",
          createdAt: (
            disposal as typeof disposal & { createdAt?: string }
          ).createdAt ?? new Date().toISOString(),
        })),
      });
    } else {
      setEditingId(null);
      form.reset({
        name: "",
        assetClass: "Mutual Funds",
        investedAmount: 0,
        currentValue: 0,
        quantity: 0,
        averageBuyPrice: 0,
        monthlyContribution: 0,
        contributionStartDate: "",
        contributionEndMode: "retirement",
        contributionEndDate: "",
        expectedReturn: 12,
        ticker: "",
        folio: "",
        institution: "",
        accountNumber: "",
        unit: "",
        location: "",
        area: "",
        maturityDate: "",
        notes: "",
        disposals: [],
      });
    }
    setIsDialogOpen(true);
  };

  const onSubmit = (data: FormValues) => {
    if (isSaving) return;
    const normalizedData = {
      ...data,
      disposals: data.disposals.map((disposal) => ({
        ...disposal,
        indexedCostBasis: disposal.indexedCostBasis === ""
          ? undefined
          : disposal.indexedCostBasis,
        grandfatheredValue: disposal.grandfatheredValue === ""
          ? undefined
          : disposal.grandfatheredValue,
      })),
    };
    if (editingId) {
      const existing = investments.find((i) => i.id === editingId)!;
      updateInvestment.mutate(
        {
          ...existing,
          ...normalizedData,
          monthlyContribution: existing.autoManagedContribution
            ? existing.monthlyContribution
            : normalizedData.monthlyContribution,
          id: editingId,
          createdAt: existing.createdAt
        },
        {
          onSuccess: () => {
            setIsDialogOpen(false);
            toast({ title: "Investment updated" });
          }
        }
      );
    } else {
      addInvestment.mutate(normalizedData, {
        onSuccess: () => {
          setIsDialogOpen(false);
          toast({ title: "Investment added" });
        }
      });
    }
  };

  const opportunityKey = (fund: DatedFundOpportunity) =>
    `${fund.sourceId}:${formatDateOnly(fund.date)}`;
  const allocatedForFund = (fund: DatedFundOpportunity) =>
    investments.reduce(
      (total, investment) =>
        total + (validFundAllocations.get(investment.id) ?? [])
          .filter((allocation) =>
            `${allocation.sourceId}:${allocation.opportunityDate}` === opportunityKey(fund))
          .reduce((sum, allocation) => sum + allocation.amount, 0),
      0,
    );
  const openAllocationDialog = (fund: DatedFundOpportunity) => {
    const remaining = Math.max(0, fund.amount - allocatedForFund(fund));
    setAllocatingFund(fund);
    setAllocationAmount(String(remaining));
    setAllocationDate(formatDateOnly(fund.date > asOf ? fund.date : asOf));
    setAllocationTarget(investments[0]?.id ?? "new");
    setAllocationName(`${fund.sourceName} investment`);
    setAllocationAssetClass("Mutual Funds");
  };
  const saveAllocation = () => {
    if (!allocatingFund || isSaving) return;
    const amount = Number(allocationAmount);
    const remaining = Math.max(0, allocatingFund.amount - allocatedForFund(allocatingFund));
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) {
      toast({
        title: "Invalid allocation amount",
        description: `Enter an amount up to ${formatINR(remaining)}.`,
        variant: "destructive",
      });
      return;
    }
    if (!allocationDate || parseDateOnly(allocationDate) < allocatingFund.date) {
      toast({
        title: "Invalid investment date",
        description: "The investment date cannot be before the fund becomes available.",
        variant: "destructive",
      });
      return;
    }
    const retirementDate = new Date(
      asOf.getFullYear(),
      asOf.getMonth() + metrics.projection.monthsToRetirement,
      0,
    );
    if (parseDateOnly(allocationDate) > retirementDate) {
      toast({
        title: "Investment date is after retirement",
        description: "Choose a date within your retirement planning horizon.",
        variant: "destructive",
      });
      return;
    }
    const allocation = {
      id: crypto.randomUUID(),
      sourceId: allocatingFund.sourceId,
      opportunityDate: formatDateOnly(allocatingFund.date),
      investmentDate: allocationDate,
      amount,
      createdAt: new Date().toISOString(),
    };
    const onSuccess = () => {
      setAllocatingFund(null);
      toast({
        title: "Fund allocated",
        description: `${formatINR(amount)} is now included in your retirement projection.`,
      });
    };
    if (allocationTarget === "new") {
      if (!allocationName.trim()) {
        toast({ title: "Investment name is required", variant: "destructive" });
        return;
      }
      addInvestment.mutate({
        name: allocationName.trim(),
        assetClass: allocationAssetClass,
        investedAmount: 0,
        currentValue: 0,
        monthlyContribution: 0,
        contributionStartDate: formatDateOnly(asOf),
        contributionEndMode: "retirement",
        expectedReturn: getDefaultReturn(allocationAssetClass),
        fundAllocations: [allocation],
      }, { onSuccess });
      return;
    }
    const target = investments.find((investment) => investment.id === allocationTarget);
    if (!target) return;
    updateInvestment.mutate({
      ...target,
      fundAllocations: [...(target.fundAllocations ?? []), allocation],
    }, { onSuccess });
  };
  const openEditAllocationDialog = (investment: Investment, allocation: FundAllocation) => {
    setEditingAllocation({ investment, allocation });
    setEditingAllocationAmount(String(allocation.amount));
    setEditingAllocationDate(allocation.investmentDate);
  };
  const saveEditedAllocation = () => {
    if (!editingAllocation || isSaving) return;
    const { investment, allocation } = editingAllocation;
    const source = incomes.find((income) => income.id === allocation.sourceId);
    const opportunityDate = parseDateOnly(allocation.opportunityDate);
    const amount = Number(editingAllocationAmount);
    const opportunityAmount = source
      ? allocationOpportunityAmount(
          source,
          opportunityDate,
          retirementInputs?.salaryGrowth ?? 0,
        )
      : 0;
    const allocatedByOthers = investments.reduce(
      (total, item) =>
        total + (validFundAllocations.get(item.id) ?? [])
          .filter((itemAllocation) =>
            itemAllocation.id !== allocation.id
            && itemAllocation.sourceId === allocation.sourceId
            && itemAllocation.opportunityDate === allocation.opportunityDate)
          .reduce((sum, itemAllocation) => sum + itemAllocation.amount, 0),
      0,
    );
    const maximum = Math.max(0, opportunityAmount - allocatedByOthers);
    if (!Number.isFinite(amount) || amount <= 0 || amount > maximum + 0.005) {
      toast({
        title: "Invalid allocation amount",
        description: `Enter an amount up to ${formatINR(maximum)}.`,
        variant: "destructive",
      });
      return;
    }
    if (!editingAllocationDate || parseDateOnly(editingAllocationDate) < opportunityDate) {
      toast({
        title: "Invalid investment date",
        description: "The investment date cannot be before the fund becomes available.",
        variant: "destructive",
      });
      return;
    }
    const retirementDate = new Date(
      asOf.getFullYear(),
      asOf.getMonth() + metrics.projection.monthsToRetirement,
      0,
    );
    if (parseDateOnly(editingAllocationDate) > retirementDate) {
      toast({
        title: "Investment date is after retirement",
        description: "Choose a date within your retirement planning horizon.",
        variant: "destructive",
      });
      return;
    }
    updateInvestment.mutate({
      ...investment,
      fundAllocations: (investment.fundAllocations ?? []).map((itemAllocation) =>
        itemAllocation.id === allocation.id
          ? {
              ...itemAllocation,
              amount,
              investmentDate: editingAllocationDate,
            }
          : itemAllocation),
    }, {
      onSuccess: () => {
        setEditingAllocation(null);
        toast({
          title: "Allocation updated",
          description: `${formatINR(amount)} will be invested on ${format(parseDateOnly(editingAllocationDate), "MMM d, yyyy")}.`,
        });
      },
    });
  };
  const removeAllocation = (investment: Investment, allocation: FundAllocation) => {
    if (isSaving) return;
    updateInvestment.mutate({
      ...investment,
      fundAllocations: (investment.fundAllocations ?? [])
        .filter((itemAllocation) => itemAllocation.id !== allocation.id),
    }, {
      onSuccess: () => {
        setEditingAllocation(null);
        toast({
          title: "Allocation removed",
          description: `${formatINR(allocation.amount)} is available to allocate again.`,
        });
      },
    });
  };

  const formValues = form.watch();
  
  const draftFeasibility = useMemo(() => {
    if (!formValues.monthlyContribution || isLinkedEPF) return null;
    
    const draftInvestment = {
      ...editingInvestment,
      id: editingId || "draft-id",
      name: formValues.name || "Draft",
      assetClass: formValues.assetClass || "Mutual Funds",
      investedAmount: formValues.investedAmount || 0,
      currentValue: formValues.currentValue || 0,
      monthlyContribution: formValues.monthlyContribution || 0,
      contributionStartDate: formValues.contributionStartDate,
      contributionEndMode: formValues.contributionEndMode,
      contributionEndDate: formValues.contributionEndDate,
      expectedReturn: formValues.expectedReturn || 12,
    } as Investment;

    const draftInvestments = editingId 
      ? investments.map(i => i.id === editingId ? draftInvestment : i)
      : [...investments, draftInvestment];

    const actualInvestmentInputs = {
      ...(retirementInputs || {
        dateOfBirth: "1990-01-01",
        targetRetirementAge: 60,
        lifeExpectancy: 85,
        generalInflation: 6,
        salaryGrowth: 8,
      }),
      monthlyContributionOverride: 0,
      investSurplus: false
    };

    const draftProj = calculateRetirementProjection({
      expenses,
      budgets,
      incomes,
      investments: draftInvestments,
      loans,
      assumptions: actualInvestmentInputs,
      asOf
    });

    return {
      feasible: draftProj.cashFlowFeasible,
      shortfall: draftProj.firstCashFlowShortfall
    };
  }, [formValues, editingInvestment, editingId, investments, expenses, budgets, incomes, loans, retirementInputs, isLinkedEPF]);

  const metrics = useMemo(() => {
    const safeInputs = retirementInputs || {
      dateOfBirth: "1990-01-01",
      targetRetirementAge: 60,
      lifeExpectancy: 85,
      generalInflation: 6,
      salaryGrowth: 8,
      monthlyContributionOverride: 0,
      investSurplus: false
    };

    // A surplus SIP saved on the Retirement page is a planning scenario, not
    // an investment commitment. This page reflects only recorded investments.
    const actualInvestmentInputs = {
      ...safeInputs,
      monthlyContributionOverride: 0,
      investSurplus: false
    };

    const projection = calculateRetirementProjection({
      expenses,
      budgets,
      incomes,
      investments,
      loans,
      assumptions: actualInvestmentInputs,
      asOf
    });

    let tInvested = 0;
    let totalCurrent = 0;
    const byAssetClass: Record<string, number> = {};

    investments.forEach((inv) => {
      tInvested += inv.investedAmount;
      totalCurrent += inv.currentValue;
      byAssetClass[inv.assetClass] =
        (byAssetClass[inv.assetClass] || 0) + inv.currentValue;
    });

    const gain = totalCurrent - tInvested;
    const gainPercent = tInvested > 0 ? (gain / tInvested) * 100 : 0;

    const pieData = Object.entries(byAssetClass)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return {
      totalInvested: tInvested,
      totalCurrent,
      gain,
      gainPercent,
      pieData,
      projection
    };
  }, [investments, retirementInputs, incomes, expenses, budgets, loans, asOf]);

  const holdings = useMemo(
    () =>
      sortInvestments(
        investments,
        uiPreferences,
        metrics.projection.yearsToRetirement,
        { asOf, monthsToRetirement: metrics.projection.monthsToRetirement, incomes }
      ),
    [investments, uiPreferences, metrics.projection.yearsToRetirement, metrics.projection.monthsToRetirement, incomes, asOf]
  );
  const manualOrder = uiPreferences.investmentSort.by === "manual";

  const isLoading =
    loadingInv ||
    loadingRet ||
    loadingInc ||
    loadingExp ||
    loadingBud ||
    loadingLoans;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-primary/20 rounded-full mb-4"></div>
          <p className="text-muted-foreground">Loading investments...</p>
        </div>
      </div>
    );
  }

  if ([investmentsQuery, retirementQuery, incomesQuery, expensesQuery, budgetsQuery, loansQuery].some((query) => query.isError)) {
    return <QueryErrorState onRetry={() => investmentsQuery.refetch()} />;
  }

  const { projection } = metrics;
  const datedFundOpportunities = projection.datedFundOpportunities;
  const fundAllocationOpportunities = projection.fundAllocationOpportunities;
  const allocatableDatedFunds = fundAllocationOpportunities.filter(
    (fund) => allocatedForFund(fund) < fund.amount,
  );
  const arrivedAllocatableFunds = allocatableDatedFunds.filter((fund) => fund.date <= asOf);
  const upcomingAllocatableFunds = allocatableDatedFunds.filter((fund) => fund.date > asOf);
  const arrivedAllocatableAmount = arrivedAllocatableFunds.reduce(
    (sum, fund) => sum + Math.max(0, fund.amount - allocatedForFund(fund)),
    0,
  );
  const upcomingAllocatableAmount = upcomingAllocatableFunds.reduce(
    (sum, fund) => sum + Math.max(0, fund.amount - allocatedForFund(fund)),
    0,
  );
  const monthlyBudgetTotal = projection.budgetTotal;
  const monthlyBudgetAndEmis = monthlyBudgetTotal + projection.activeEmi;
  const retirementNeeds =
    projection.modeledTakeHomeContribution + projection.extraSipRequired;
  const remainingUnallocatedSurplus = Math.max(
    0,
    projection.unallocatedSurplus - projection.selectedTakeHomeInvestment
  );
  const canAfford = remainingUnallocatedSurplus >= projection.extraSipRequired;
  const additionalMonthlyCapacityNeeded = Math.max(
    0,
    projection.extraSipRequired - remainingUnallocatedSurplus
  );
  const investmentExportSheets = buildInvestmentReportSheets({
    holdings,
    incomes,
    asOf,
    yearsToRetirement: projection.yearsToRetirement,
    monthsToRetirement: projection.monthsToRetirement,
    annualFunds: datedFundOpportunities,
    yearlyOutlook: projection.projectedYearlySurplusOutlook,
  });
  const yearlyOutlookExportSheets = investmentExportSheets.filter(
    (sheet) => sheet.name === "Yearly Outlook",
  );

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-8 md:pb-12">
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="pr-12 sm:pr-0">
          <h1 className="text-2xl md:text-3xl font-serif text-primary">
            Investment Portfolio
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Manage your holdings, SIPs, and track your wealth growth.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="absolute right-0 top-0 sm:static">
            <DownloadExcelButton
              sheets={investmentExportSheets}
              reportSlug="investments_report"
              className="max-w-full"
            />
          </div>
          <Button onClick={() => handleOpenDialog()} className="shadow-sm">
            <Plus className="h-4 w-4 mr-2" /> Add Investment
          </Button>
        </div>
      </div>

      {/* Available to Invest */}
      <Collapsible open={isGapAnalysisOpen} onOpenChange={setIsGapAnalysisOpen}>
        <div className="w-full bg-card rounded-2xl overflow-hidden shadow-sm border border-border">
          <div className="bg-card p-4 md:p-6">
            <div className="flex items-start justify-between gap-2 md:items-center md:gap-3">
              <div className="min-w-0 md:flex md:flex-wrap md:items-center md:gap-3">
                <h2 className="truncate font-serif text-lg md:text-xl">Available to Invest</h2>
                {projection.extraSipRequired > 0 ? (
                  <span className="mt-1.5 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-tiny font-semibold text-muted-foreground md:mt-0 md:px-3 md:py-1 md:text-xs">
                    ACTION REQUIRED
                  </span>
                ) : (
                  <span className="mt-1.5 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-tiny font-semibold text-muted-foreground md:mt-0 md:px-3 md:py-1 md:text-xs">
                    FULLY FUNDED
                  </span>
                )}
              </div>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs md:h-9 md:gap-1.5 md:px-3 md:text-sm">
                  <span className="md:hidden">{isGapAnalysisOpen ? "Hide" : "Details"}</span>
                  <span className="hidden md:inline">{isGapAnalysisOpen ? "Hide calculations" : "View retirement gap details"}</span>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isGapAnalysisOpen && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5 md:mt-4 md:gap-4">
              <div className="min-w-0 rounded-xl border border-border bg-card p-3 md:p-5" data-testid="investments-monthly-surplus">
                <p className="text-tiny font-semibold uppercase tracking-wide text-muted-foreground md:text-sm">Monthly Surplus</p>
                <p className={cn("mt-1 truncate font-sans text-xl font-bold md:mt-2 md:text-3xl", remainingUnallocatedSurplus > 0 ? "text-warning" : remainingUnallocatedSurplus < 0 ? "text-negative" : "text-foreground")}>
                  {formatINR(remainingUnallocatedSurplus)}<span className="text-tiny font-normal md:text-lg">/mo</span>
                </p>
                <p className="mt-1.5 text-tiny font-medium leading-snug text-muted-foreground md:mt-2 md:text-sm">
                  <span className="md:hidden">Free after monthly commitments.</span>
                  <span className="hidden md:inline">
                  After living costs, active EMIs, existing SIPs, and planned take-home SIPs.
                  </span>
                </p>
              </div>
              <div className="min-w-0 rounded-xl border border-border bg-card p-3 md:p-5" data-testid="investments-lump-sum">
                <p className="text-tiny font-semibold uppercase tracking-wide text-muted-foreground md:text-sm">Lump-Sum Available</p>
                <p className={cn("mt-1 truncate font-sans text-xl font-bold md:mt-2 md:text-3xl", projection.lumpSumAvailable > 0 ? "text-warning" : projection.lumpSumAvailable < 0 ? "text-negative" : "text-foreground")}>
                  {formatINR(projection.lumpSumAvailable)}
                </p>
                <p className="mt-1.5 text-tiny font-medium leading-snug text-muted-foreground md:mt-2 md:text-sm">
                  <span className="md:hidden">Arrived funds not yet committed.</span>
                  <span className="hidden md:inline">
                  Arrived annual or one-time funds not already committed to an investment.
                  </span>
                </p>
                {allocatableDatedFunds.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 w-full border-border bg-background/80 px-2 text-tiny text-foreground hover:bg-muted md:mt-4 md:h-9 md:w-auto md:px-3 md:text-sm"
                    onClick={() => openAllocationDialog(allocatableDatedFunds[0])}
                    data-testid="button-plan-lump-sum-investment"
                  >
                    <span className="md:hidden">Plan fund</span>
                    <span className="hidden md:inline">Plan a lump-sum fund</span>
                  </Button>
                )}
              </div>
            </div>

            <CollapsibleContent>
              <div className="mt-4 grid grid-cols-1 gap-4 border-t border-border/60 pt-4 md:mt-6 md:gap-8 md:pt-6 lg:grid-cols-[1fr_2px_1fr]">
                <div className="space-y-1 md:space-y-4">
                  <div className="flex items-center justify-between py-2 border-b border-border/50">
                    <span className="text-[13px] leading-tight text-muted-foreground md:text-base">Monthly Income</span>
                    <span className="shrink-0 font-semibold tabular-nums text-[13px] text-positive md:text-base">
                      {formatINR(projection.netMonthlyIncome)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border/50">
                    <span className="text-[13px] leading-tight text-muted-foreground md:text-base">
                      Monthly Budgets + EMIs
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-[13px] text-foreground md:text-base">
                      -{formatINR(monthlyBudgetAndEmis)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="max-w-[58%] text-[13px] font-semibold leading-tight text-foreground md:max-w-none md:text-base md:font-medium">
                      Monthly Available for Investment
                    </span>
                    <span className={cn("shrink-0 text-sm font-bold tabular-nums md:text-lg", projection.availableSurplus > 0 ? "text-warning" : projection.availableSurplus < 0 ? "text-negative" : "text-foreground")}>
                      {formatINR(projection.availableSurplus)}
                    </span>
                  </div>
                  <p className="text-tiny leading-snug text-muted-foreground md:text-xs md:leading-relaxed">
                    Planning costs use the higher of your monthly budget and
                    normalized ledger spending.
                  </p>
                </div>

                <div className="hidden lg:block bg-border/50"></div>

                <div className="space-y-1 md:space-y-4">
                  <div className="flex items-center justify-between py-2 border-b border-border/50">
                    <span className="text-[13px] leading-tight text-muted-foreground md:text-base">
                      Planned Take-home SIPs
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-[13px] text-positive md:text-base">
                      {formatINR(projection.modeledTakeHomeContribution)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border/50">
                    <span className="text-[13px] leading-tight text-muted-foreground md:text-base">Salary-linked PF</span>
                    <span className="shrink-0 font-semibold tabular-nums text-[13px] text-positive md:text-base">
                      {formatINR(projection.linkedPFContribution)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border/50">
                    <span className="text-[13px] leading-tight text-muted-foreground md:text-base">
                      Take-home SIPs Needed
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-[13px] text-positive md:text-base">
                      {formatINR(retirementNeeds)}
                    </span>
                  </div>

                  <div className="pt-2">
                    {projection.extraSipRequired > 0 ? (
                      <div className="rounded-xl border border-border bg-muted/40 p-3 md:p-4">
                        <div className="flex items-start gap-2 md:gap-3">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground md:h-5 md:w-5" />
                          <div>
                            <p className="mb-1 text-xs font-semibold leading-snug text-foreground md:text-sm">
                              You are <span className="text-negative">{formatINR(projection.extraSipRequired)}</span> short every month.
                            </p>
                            {canAfford ? (
                              <p className="text-tiny font-medium leading-snug text-muted-foreground md:text-sm md:leading-normal">
                                Good news: You have enough monthly surplus to
                                close this gap. Increase your SIPs now.
                              </p>
                            ) : (
                              <p className="text-tiny font-medium leading-snug text-muted-foreground md:text-sm md:leading-normal">
                                You cannot afford this with your current expenses.
                                Cut discretionary spending to retire on time.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-border bg-muted/40 p-3 md:p-4">
                        <div className="flex items-start gap-2 md:gap-3">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground md:h-5 md:w-5" />
                          <div>
                            <p className="mb-1 text-xs font-semibold leading-snug text-foreground md:text-sm">
                              Your current investments cover your retirement needs.
                            </p>
                            <p className="text-tiny font-medium leading-snug text-muted-foreground md:text-sm md:leading-normal">
                              You still have{" "}
                              <span className="text-warning">{formatINR(remainingUnallocatedSurplus)}</span>/mo available.
                              Keep investing to retire earlier.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="pt-2">
                    <Link href="/advice" className="block outline-none">
                      <div className="group flex cursor-pointer items-center justify-between rounded-xl border border-primary/20 bg-primary/5 p-2.5 transition-colors hover:bg-primary/10 md:p-3">
                        <div className="flex items-center gap-2 text-primary">
                          <MessageSquareHeart className="h-4 w-4" />
                          <span className="text-xs font-medium leading-tight md:text-sm">
                            Review this plan with an expert
                          </span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-primary opacity-80 group-hover:opacity-100 transition-colors" />
                      </div>
                    </Link>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </div>
      </Collapsible>

      <Dialog open={Boolean(allocatingFund)} onOpenChange={(open) => !open && setAllocatingFund(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-serif">Plan lump-sum investment</DialogTitle>
            <DialogDescription>
              {allocatingFund
                ? allocatingFund.date <= asOf
                  ? `${allocatingFund.sourceName} has been available since ${format(allocatingFund.date, "MMM d, yyyy")}. Allocate it now or choose the actual investment date.`
                  : `${allocatingFund.sourceName} is expected on ${format(allocatingFund.date, "MMM d, yyyy")}. You can plan it now, and it will count only from the investment date.`
                : "Allocate all or part of this fund. Only the committed amount will count toward your projected corpus."}
            </DialogDescription>
          </DialogHeader>
          {allocatingFund && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Annual or one-time fund</label>
                <Select
                  value={opportunityKey(allocatingFund)}
                  onValueChange={(key) => {
                    const selected = allocatableDatedFunds.find(
                      (fund) => opportunityKey(fund) === key,
                    );
                    if (selected) openAllocationDialog(selected);
                  }}
                >
                  <SelectTrigger data-testid="select-allocation-fund">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allocatableDatedFunds.map((fund) => (
                      <SelectItem key={opportunityKey(fund)} value={opportunityKey(fund)}>
                        {fund.sourceName} · {format(fund.date, "MMM d, yyyy")} · {formatINR(fund.amount - allocatedForFund(fund))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span>Available</span>
                  <span className="font-semibold">
                    {formatINR(Math.max(0, allocatingFund.amount - allocatedForFund(allocatingFund)))}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="allocation-amount">Allocation amount</label>
                <Input
                  id="allocation-amount"
                  type="number"
                  min="1"
                  max={Math.max(0, allocatingFund.amount - allocatedForFund(allocatingFund))}
                  value={allocationAmount}
                  onChange={(event) => setAllocationAmount(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="allocation-date">Investment date</label>
                <DatePickerInput
                  id="allocation-date"
                  value={allocationDate ? parseDateOnly(allocationDate) : undefined}
                  onChange={(date) => setAllocationDate(date ? formatDateOnly(date) : "")}
                  minDate={allocatingFund.date}
                  maxDate={new Date(
                    asOf.getFullYear(),
                    asOf.getMonth() + projection.monthsToRetirement,
                    0,
                  )}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Investment</label>
                <Select value={allocationTarget} onValueChange={setAllocationTarget}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Create a new investment</SelectItem>
                    {investments.map((investment) => (
                      <SelectItem key={investment.id} value={investment.id}>{investment.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {allocationTarget === "new" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="allocation-name">Investment name</label>
                    <Input id="allocation-name" value={allocationName} onChange={(event) => setAllocationName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Asset class</label>
                    <Select value={allocationAssetClass} onValueChange={(value) => setAllocationAssetClass(value as AssetClass)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {assetClasses.map((assetClass) => <SelectItem key={assetClass} value={assetClass}>{assetClass}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <Button className="w-full" disabled={isSaving} onClick={saveAllocation}>
                {isSaving ? "Saving..." : "Confirm allocation"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingAllocation)} onOpenChange={(open) => !open && setEditingAllocation(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-serif">Revise fund allocation</DialogTitle>
            <DialogDescription>
              Change the committed amount or investment date without changing its source fund.
            </DialogDescription>
          </DialogHeader>
          {editingAllocation && (() => {
            const source = incomes.find(
              (income) => income.id === editingAllocation.allocation.sourceId,
            );
            const opportunityDate = parseDateOnly(editingAllocation.allocation.opportunityDate);
            const opportunityAmount = source
              ? allocationOpportunityAmount(
                  source,
                  opportunityDate,
                  retirementInputs?.salaryGrowth ?? 0,
                )
              : editingAllocation.allocation.amount;
            const allocatedByOthers = investments.reduce(
              (total, investment) =>
                total + (validFundAllocations.get(investment.id) ?? [])
                  .filter((allocation) =>
                    allocation.id !== editingAllocation.allocation.id
                    && allocation.sourceId === editingAllocation.allocation.sourceId
                    && allocation.opportunityDate === editingAllocation.allocation.opportunityDate)
                  .reduce((sum, allocation) => sum + allocation.amount, 0),
              0,
            );
            const maximum = Math.max(0, opportunityAmount - allocatedByOthers);
            return (
              <div className="space-y-4 py-2">
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <p className="font-medium">{source?.name ?? "Dated fund"}</p>
                  <p className="mt-1 text-muted-foreground">
                    Available {format(opportunityDate, "MMM d, yyyy")} · Up to {formatINR(maximum)}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="edit-allocation-amount">Allocation amount</label>
                  <Input
                    id="edit-allocation-amount"
                    type="number"
                    min="1"
                    max={maximum}
                    value={editingAllocationAmount}
                    onChange={(event) => setEditingAllocationAmount(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="edit-allocation-date">Investment date</label>
                  <DatePickerInput
                    id="edit-allocation-date"
                    value={editingAllocationDate ? parseDateOnly(editingAllocationDate) : undefined}
                    onChange={(date) => setEditingAllocationDate(date ? formatDateOnly(date) : "")}
                    minDate={opportunityDate}
                    maxDate={new Date(
                      asOf.getFullYear(),
                      asOf.getMonth() + projection.monthsToRetirement,
                      0,
                    )}
                  />
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                  <Button
                    variant="destructive"
                    disabled={isSaving}
                    onClick={() => removeAllocation(
                      editingAllocation.investment,
                      editingAllocation.allocation,
                    )}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove allocation
                  </Button>
                  <Button disabled={isSaving} onClick={saveEditedAllocation}>
                    {isSaving ? "Saving..." : "Save changes"}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deletingInvestment)}
        onOpenChange={(open) => !open && setDeletingInvestment(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deletingInvestment?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this investment. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteInvestment.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deletingInvestment) return;
                deleteInvestment.mutate(deletingInvestment.id, {
                  onSuccess: () => {
                    toast({ title: "Investment deleted" });
                    setDeletingInvestment(null);
                  },
                });
              }}
            >
              {deleteInvestment.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Collapsible open={isYearlyOutlookOpen} onOpenChange={setIsYearlyOutlookOpen}>
        <Card className="border-0 shadow-sm bg-card" data-testid="yearly-surplus-outlook">
          <CardHeader className="relative gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pb-6">
            <div className="min-w-0 pr-12 sm:pr-0">
              <CardTitle className="text-lg font-serif">
                Estimated yearly surplus outlook
              </CardTitle>
              <CardDescription className="mt-1">
                A year-by-year estimate of monthly cash flow. Annual funds stay separate from surplus.
              </CardDescription>
            </div>
            <div className="absolute right-4 top-4 sm:static sm:flex sm:items-center sm:gap-2">
              <DownloadExcelButton
                sheets={yearlyOutlookExportSheets}
                reportSlug="yearly_surplus_outlook"
                size="sm"
                className="min-w-0"
              />
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="hidden min-w-0 shrink-0 justify-between sm:inline-flex sm:justify-center"
                  aria-expanded={isYearlyOutlookOpen}
                  data-testid="button-toggle-yearly-surplus-outlook"
                >
                  {isYearlyOutlookOpen ? "Hide outlook" : "View outlook"}
                  <ChevronDown
                    className={cn(
                      "ml-2 h-4 w-4 transition-transform",
                      isYearlyOutlookOpen && "rotate-180",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
            <div className="flex w-full justify-end sm:hidden">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  aria-expanded={isYearlyOutlookOpen}
                  data-testid="button-toggle-yearly-surplus-outlook-mobile"
                >
                  {isYearlyOutlookOpen ? "Hide outlook" : "View outlook"}
                  <ChevronDown
                    className={cn(
                      "ml-2 h-4 w-4 transition-transform",
                      isYearlyOutlookOpen && "rotate-180",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="max-h-[300px] overflow-auto rounded-xl border border-border">
                <table className="w-full min-w-[880px] text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/95 text-left backdrop-blur">
                    <tr>
                      <th className="px-4 py-3 font-medium">Year</th>
                      <th className="px-4 py-3 text-right font-medium">Estimated income/mo</th>
                      <th className="px-4 py-3 text-right font-medium">Estimated living/mo</th>
                      <th className="px-4 py-3 text-right font-medium">Scheduled outflows/mo</th>
                      <th className="px-4 py-3 text-right font-medium">Estimated surplus/mo</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Annual funds (separate from surplus/mo)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {projection.projectedYearlySurplusOutlook.map((entry) => (
                      <tr key={entry.year} className="border-t border-border/70">
                        <td className="px-4 py-3 font-medium">{entry.year}</td>
                        <td className="px-4 py-3 text-right">{formatINR(entry.income)}</td>
                        <td className="px-4 py-3 text-right">{formatINR(entry.living)}</td>
                        <td className="px-4 py-3 text-right">
                          {formatINR(
                            entry.loanEmi
                              + entry.scheduledInvestments
                              + entry.planningInvestment,
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">
                          {formatINR(entry.surplus)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">
                          {formatINR(entry.annualFunds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {allocatableDatedFunds.length > 0 && (
                <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="font-semibold text-foreground">
                        Decide how to use annual funds
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        These funds are separate from monthly surplus. You can allocate arrived money now or plan an upcoming fund in advance.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {arrivedAllocatableFunds[0] && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => openAllocationDialog(arrivedAllocatableFunds[0])}
                        >
                          Allocate <span className="text-warning">{formatINR(arrivedAllocatableAmount)}</span> now
                        </Button>
                      )}
                      {upcomingAllocatableFunds[0] && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openAllocationDialog(upcomingAllocatableFunds[0])}
                        >
                          Plan <span className="text-foreground">{formatINR(upcomingAllocatableAmount)}</span> upcoming
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <p>
                      <span className="font-semibold">Available now:</span>{" "}
                      {arrivedAllocatableFunds.length > 0
                        ? <span className="text-warning">{formatINR(arrivedAllocatableAmount)}</span>
                        : "No unallocated funds"}
                    </p>
                    <p>
                      <span className="font-semibold">Next availability:</span>{" "}
                      {upcomingAllocatableFunds[0]
                        ? `${upcomingAllocatableFunds[0].sourceName} on ${format(upcomingAllocatableFunds[0].date, "MMM d, yyyy")}`
                        : "No upcoming funds"}
                    </p>
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Scroll inside the table to review later years. Annual funds are investable lump sums, but are not included in monthly surplus.
              </p>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card className="min-w-0 border-0 shadow-sm bg-card">
          <CardContent className="space-y-3 p-4 md:p-5">
            <div className="space-y-1">
              <CardDescription className="font-medium text-tiny uppercase tracking-wider md:text-xs">
                Current Value
              </CardDescription>
              <CardTitle className="w-full text-lg font-sans font-bold text-positive sm:text-xl xl:text-2xl">
                <InvestmentMetricCurrency value={metrics.totalCurrent} />
              </CardTitle>
            </div>
            <div className="flex items-center text-xs md:text-sm">
              <span className="text-muted-foreground">
                Invested: <span className="text-positive"><InvestmentMetricCurrency value={metrics.totalInvested} /></span>
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-0 shadow-sm bg-card">
          <CardContent className="space-y-3 p-4 md:p-5">
            <div className="space-y-1">
              <CardDescription className="font-medium text-tiny uppercase tracking-wider md:text-xs">
                Overall Return
              </CardDescription>
              <CardTitle
                className={cn(
                  "w-full text-lg font-sans font-bold sm:text-xl xl:text-2xl",
                  metrics.gain > 0
                    ? "text-positive"
                    : metrics.gain < 0
                      ? "text-negative"
                      : "text-foreground"
                )}
              >
                <InvestmentMetricCurrency value={metrics.gain} prefix={metrics.gain >= 0 ? "+" : ""} />
              </CardTitle>
            </div>
            <div className="flex items-center text-tiny md:text-sm truncate">
              <span
                className={cn(
                  "font-medium",
                  metrics.gainPercent > 0
                    ? "text-positive"
                    : metrics.gainPercent < 0
                      ? "text-negative"
                      : "text-foreground"
                )}
              >
                {metrics.gainPercent >= 0 ? "+" : ""}
                {metrics.gainPercent.toFixed(2)}%
              </span>
              <span className="text-muted-foreground ml-1 md:ml-2">absolute gain</span>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-0 shadow-sm bg-card">
          <CardContent className="space-y-3 p-4 md:p-5">
            <div className="space-y-1">
              <CardDescription className="font-medium text-tiny uppercase tracking-wider md:text-xs">
                Monthly SIPs
              </CardDescription>
              <CardTitle className="w-full text-lg font-sans font-bold text-positive sm:text-xl xl:text-2xl">
                <InvestmentMetricCurrency value={projection.currentSipCommitments} />
              </CardTitle>
            </div>
            <div className="flex items-center text-tiny md:text-sm truncate">
              <span className="text-muted-foreground truncate">
                Active contributions
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="relative min-w-0 overflow-hidden border-0 bg-card shadow-sm">
          <div className="pointer-events-none absolute -right-8 -top-10 hidden h-24 w-24 rounded-full bg-muted/30 blur-2xl dark:block" aria-hidden="true" />
          <CardContent className="relative z-10 space-y-3 p-4 md:p-5">
            <div className="space-y-1">
              <CardDescription className="truncate font-medium text-tiny uppercase tracking-wider text-muted-foreground md:text-xs">
                Proj. at Retirement (
                {Math.max(0, Math.round(projection.yearsToRetirement))} yrs)
              </CardDescription>
              <CardTitle className="w-full text-lg font-sans font-bold text-foreground sm:text-xl xl:text-2xl">
                <InvestmentMetricCurrency value={projection.projectedCorpus} />
              </CardTitle>
            </div>
            <p className="truncate text-tiny text-muted-foreground md:text-sm">
              Based on expected returns
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <Card className="border-0 shadow-sm bg-card lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 p-4 md:p-6">
            <div className="flex w-full items-start justify-between gap-3">
              <CardTitle className="min-w-0 pt-2 text-base font-serif md:text-lg sm:pt-1">
                Your Holdings
              </CardTitle>
              {investments.length > 1 ? (
                <CardSortControls
                  value={uiPreferences.investmentSort.by}
                  direction={uiPreferences.investmentSort.direction}
                  options={
                    [
                      { value: "manual", label: "Custom Order" },
                      { value: "invested", label: "Invested" },
                      { value: "current", label: "Current Value" },
                      { value: "gain", label: "Gain / Loss" },
                      { value: "projected", label: "Proj. @ Retirement" }
                    ] satisfies { value: InvestmentSortBy; label: string }[]
                  }
                  onByChange={(by) =>
                    updatePreferences.mutate({
                      investmentSort: { ...uiPreferences.investmentSort, by }
                    })
                  }
                  onDirectionChange={(direction) =>
                    updatePreferences.mutate({
                      investmentSort: {
                        ...uiPreferences.investmentSort,
                        direction
                      }
                    })
                  }
                  compactOnMobile
                  className="shrink-0"
                />
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {holdings.length > 0 ? (
              <SortableCardList
                ids={holdings.map((holding) => holding.id)}
                enabled={manualOrder}
                onReorder={(investmentOrder) =>
                  updatePreferences.mutate({ investmentOrder })
                }
              >
                {holdings.map((inv) => {
                  const gain = inv.currentValue - inv.investedAmount;
                  const gainPct =
                    inv.investedAmount > 0
                      ? (gain / inv.investedAmount) * 100
                      : 0;
                  const linkedIncome = inv.autoManagedContribution && inv.linkedIncomeSourceId
                    ? incomes.find((income) => income.id === inv.linkedIncomeSourceId)
                    : undefined;
                  const linkedIncomeAvailable = linkedIncome
                    ? isRecurringIncomeActive(linkedIncome, asOf)
                    : false;
                  const displayedContribution = inv.autoManagedContribution && inv.linkedIncomeSourceId
                    && !linkedIncomeAvailable
                    ? 0
                    : inv.monthlyContribution || 0;
                  const projVal = investmentProjectedValue(
                    inv,
                    projection.yearsToRetirement,
                    {
                      asOf,
                      monthsToRetirement: projection.monthsToRetirement,
                      incomes,
                      legacySalaryGrowth: retirementInputs?.salaryGrowth ?? 0,
                    }
                  );
                  const validInvestmentAllocations = validFundAllocations.get(inv.id) ?? [];
                  const plannedLumpSum = validInvestmentAllocations
                    .reduce((sum, allocation) => sum + allocation.amount, 0);

                  const startStr = inv.contributionStartDate;
                  let endMode = inv.contributionEndMode || "retirement";
                  let endStr = inv.contributionEndDate;
                  if (
                    linkedIncome?.incomeEndMode === "custom"
                    && linkedIncome.incomeEndDate
                    && (
                      endMode !== "custom"
                      || !endStr
                      || parseDateOnly(linkedIncome.incomeEndDate) < parseDateOnly(endStr)
                    )
                  ) {
                    endMode = "custom";
                    endStr = linkedIncome.incomeEndDate;
                  }
                  
                  let scheduleText = "";
                  let status: "Upcoming" | "Active" | "Completed" = "Completed";
                  
                  if (displayedContribution > 0) {
                    const startDate = startStr ? parseDateOnly(startStr) : new Date();
                    const isUpcoming = startDate > asOf;
                    const endDate = endMode === "custom" && endStr ? parseDateOnly(endStr) : null;
                    const isCustomEnded = Boolean(
                      endDate
                      && (
                        endDate.getFullYear() < asOf.getFullYear()
                        || (
                          endDate.getFullYear() === asOf.getFullYear()
                          && endDate.getMonth() < asOf.getMonth()
                        )
                      ),
                    );
                    const isRetired = projection.monthsToRetirement <= 0;
                    
                    if (isUpcoming) {
                      status = "Upcoming";
                      scheduleText = `Starts ${format(startDate, "MMM yyyy")}`;
                      if (endMode === "custom" && endStr) {
                        scheduleText += ` • Ends ${format(parseDateOnly(endStr), "MMM yyyy")}`;
                      } else {
                        scheduleText += ` • Till Retirement`;
                      }
                    } else if (isCustomEnded || (endMode === "retirement" && isRetired)) {
                      status = "Completed";
                      scheduleText = `Contributions completed`;
                    } else {
                      status = "Active";
                      scheduleText = startStr ? `Started ${format(startDate, "MMM yyyy")}` : "Active SIP";
                      if (endMode === "custom" && endStr) {
                        scheduleText += ` • Ends ${format(parseDateOnly(endStr), "MMM yyyy")}`;
                      } else {
                        scheduleText += ` • Till Retirement`;
                      }
                    }
                  } else {
                    status = "Completed";
                    scheduleText = inv.autoManagedContribution && inv.linkedIncomeSourceId
                      ? "Linked salary contributions completed"
                      : "No active contributions";
                  }

                  return (
                    <SortableCard
                      key={inv.id}
                      id={inv.id}
                      enabled={manualOrder}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                        <div className="flex min-w-0 items-start gap-3 pr-8 sm:gap-4 sm:pr-0">
                           <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground sm:mt-1 sm:h-10 sm:w-10">
                            <PiggyBank className="h-4 w-4 sm:h-5 sm:w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold leading-tight sm:text-base sm:leading-normal">
                              {inv.name}
                            </p>
                            <p className="mt-0.5 text-xs leading-snug text-muted-foreground sm:mt-0 sm:text-sm sm:leading-normal">
                              {inv.assetClass} • {inv.expectedReturn}% Exp.
                              Return
                            </p>
                            {inv.monthlyContribution ||
                            inv.autoManagedContribution ? (
                              <div className="mt-1">
                                <span className="inline-flex max-w-full flex-wrap items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                                  {inv.autoManagedContribution
                                    ? "Salary-synced PF"
                                   : "SIP"}
                                   : <span className="text-positive">{formatINR(displayedContribution)}</span>/mo
                                </span>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {status} · {scheduleText}
                                </p>
                                {inv.autoManagedContribution && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {linkedIncomeAvailable
                                      ? "Edit this contribution from the linked Salary in Income."
                                      : "This contribution ended with the linked salary's availability."}
                                  </p>
                                )}
                              </div>
                            ) : null}
                            {plannedLumpSum > 0 && (
                              <div className="mt-3 space-y-2">
                                 <p className="text-xs font-medium text-muted-foreground">
                                   {formatINR(plannedLumpSum)} planned from dated funds
                                </p>
                                <div className="space-y-1.5">
                                  {validInvestmentAllocations.map((allocation) => {
                                    const source = incomes.find((income) => income.id === allocation.sourceId);
                                    return (
                                      <div
                                        key={allocation.id}
                                        className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-2.5 py-2 text-xs"
                                      >
                                        <div className="min-w-0">
                                          <p className="truncate font-medium">
                                            {source?.name ?? "Dated fund"} · {formatINR(allocation.amount)}
                                          </p>
                                          <p className="text-muted-foreground">
                                            Invest {format(parseDateOnly(allocation.investmentDate), "MMM d, yyyy")}
                                          </p>
                                        </div>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="shrink-0"
                                          onClick={() => openEditAllocationDialog(inv, allocation)}
                                          aria-label={`Edit ${inv.name} allocation from ${source?.name ?? "dated fund"}`}
                                        >
                                          <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                          Edit
                                        </Button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="absolute right-2 top-2 sm:hidden">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-muted-foreground"
                                aria-label={`More actions for ${inv.name}`}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-36">
                              <DropdownMenuItem onSelect={() => handleOpenDialog(inv)}>
                                <Pencil className="h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => setDeletingInvestment(inv)}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <div className="hidden shrink-0 items-center gap-2 sm:flex">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${inv.name}`}
                            onClick={() => handleOpenDialog(inv)}
                          >
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <ConfirmDeleteButton
                            itemName={inv.name}
                            entityLabel="investment"
                            onConfirm={() => {
                              deleteInvestment.mutate(inv.id, {
                                onSuccess: () =>
                                  toast({ title: "Investment deleted" })
                              });
                            }}
                          />
                        </div>
                      </div>

                      <div className="mt-1 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 border-t border-border/50 pt-3 text-xs sm:mt-2 sm:gap-4 sm:pt-4 sm:text-sm md:grid-cols-4">
                        <div className="min-w-0">
                          <p className="mb-0.5 text-tiny text-muted-foreground sm:mb-1 sm:text-sm">Invested</p>
                          <p className="[overflow-wrap:anywhere] font-semibold text-positive">
                            {formatINR(inv.investedAmount)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="mb-0.5 text-tiny text-muted-foreground sm:mb-1 sm:text-sm">
                            Current Value
                          </p>
                          <p className="[overflow-wrap:anywhere] font-semibold text-positive">
                            {formatINR(inv.currentValue)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="mb-0.5 text-tiny text-muted-foreground sm:mb-1 sm:text-sm">
                            Gain / Loss
                          </p>
                          <p
                            className={cn(
                              "[overflow-wrap:anywhere] font-semibold",
                              gain > 0
                                ? "text-positive"
                                : gain < 0
                                  ? "text-negative"
                                  : "text-foreground"
                            )}
                          >
                            {gain >= 0 ? "+" : ""}
                            {formatINR(gain)}{" "}
                            <span className="text-tiny opacity-80 font-normal sm:text-xs">
                              ({gainPct.toFixed(2)}%)
                            </span>
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="mb-0.5 text-tiny text-muted-foreground sm:mb-1 sm:text-sm">
                            Proj. @ Retirement
                          </p>
                          <p className="[overflow-wrap:anywhere] font-semibold text-foreground">
                            {formatINR(projVal)}
                          </p>
                        </div>
                      </div>
                    </SortableCard>
                  );
                })}
              </SortableCardList>
            ) : (
              <div className="w-full py-16 flex flex-col items-center justify-center text-muted-foreground border border-dashed border-border rounded-xl">
                <PiggyBank className="h-12 w-12 mb-3 opacity-20" />
                <p>No investments recorded.</p>
                <Button
                  variant="link"
                  onClick={() => handleOpenDialog()}
                  className="mt-2 text-primary"
                >
                  Start tracking your portfolio
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-card">
          <CardHeader className="p-4 md:p-6 md:pb-4">
            <CardTitle className="text-base md:text-lg font-serif">
              Asset Allocation
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0 flex flex-col items-center justify-center gap-4 md:gap-6">
            {metrics.pieData.length > 0 ? (
              <>
                <div className="flex flex-col items-center gap-2">
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
                            <Cell
                              key={`cell-${index}`}
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          formatter={(value: number) => formatINR(value)}
                          contentStyle={{
                            borderRadius: "8px",
                            border: "none",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {metrics.totalCurrent === 0 && (
                    <p className="max-w-[240px] text-center text-sm text-muted-foreground">
                      Allocation percentages will appear once a holding has value.
                    </p>
                  )}
                </div>
                <div className="mx-auto w-full max-w-[19rem] flex-1 space-y-2 md:mx-0 md:max-w-none md:space-y-3">
                  {metrics.pieData.map((entry, index) => {
                    const pct = portfolioAllocationPercent(entry.value, metrics.totalCurrent);
                    return (
                      <div
                        key={entry.name}
                        className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                CHART_COLORS[index % CHART_COLORS.length]
                            }}
                          />
                          <span className="min-w-0 truncate text-sm font-medium md:break-words md:whitespace-normal">
                            {entry.name}
                          </span>
                        </div>
                        <span className="financial-number text-right text-sm font-medium text-foreground">
                          {formatINR(entry.value)}
                        </span>
                        <span className="financial-number min-w-11 text-right text-xs text-muted-foreground">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="w-full py-12 flex flex-col items-center justify-center text-muted-foreground">
                <PieChartIcon className="h-12 w-12 mb-3 opacity-20" />
                <p>No data to display.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="w-[calc(100%-2rem-var(--app-safe-left)-var(--app-safe-right))] max-w-2xl rounded-xl p-6 flex flex-col gap-0 lg:w-[calc(100%-2rem)]">
          <DialogHeader className="shrink-0 pb-4">
            <DialogTitle>
              {editingId ? "Edit Investment" : "Add Investment"}
            </DialogTitle>
            <DialogDescription>
              Enter the details of your holding. Input fields are highlighted in
              blue.
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
                      <FormLabel>Investment Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Nifty 50 Index"
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
                  name="assetClass"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asset Class</FormLabel>
                      <Select
                        disabled={isLinkedEPF}
                        onValueChange={(val: AssetClass) => {
                          field.onChange(val);
                          form.setValue(
                            "expectedReturn",
                            getDefaultReturn(val)
                          );
                        }}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="text-secondary font-medium">
                            <SelectValue placeholder="Select class" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {assetClasses.map((ac) => (
                            <SelectItem key={ac} value={ac}>
                              {ac}
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
                  name="investedAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total Invested Amount (₹)</FormLabel>
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
                  name="currentValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Value (₹)</FormLabel>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="monthlyContribution"
                  render={({ field }) => (
                    <FormItem>
                      <FormFieldHeader className="md:min-h-10">
                        <FormLabel>
                          {isLinkedEPF
                            ? "Monthly PF contribution (synced)"
                            : "Monthly SIP / Contribution (₹)"}
                        </FormLabel>
                      </FormFieldHeader>
                      <FormControl>
                        <Input
                          type="number"
                          formatWithCommas
                          disabled={isLinkedEPF}
                          className={cn(
                            "font-medium",
                            isLinkedEPF
                              ? "bg-muted text-muted-foreground"
                              : "text-secondary"
                          )}
                          {...field}
                        />
                      </FormControl>
                      {isLinkedEPF && (
                        <p className="text-xs text-muted-foreground">
                          Managed by the linked Salary. Update Employee PF on
                          the Income page.
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="expectedReturn"
                  render={({ field }) => (
                    <FormItem>
                      <FormFieldHeader className="md:min-h-10">
                        <FormLabel>Expected Annual Return (%)</FormLabel>
                      </FormFieldHeader>
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
                
                {!isLinkedEPF && (
                  <>
                    <FormField
                      control={form.control}
                      name="contributionStartDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contribution Start Date</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              className="text-secondary font-medium"
                              {...field}
                              value={field.value || ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="contributionEndMode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contribution Ends</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="text-secondary font-medium">
                                <SelectValue placeholder="Select when to stop" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="retirement">At Retirement</SelectItem>
                              <SelectItem value="custom">Custom Date</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {form.watch("contributionEndMode") === "custom" && (
                      <FormField
                        control={form.control}
                        name="contributionEndDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Contribution End Date</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                className="text-secondary font-medium"
                                {...field}
                                value={field.value || ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </>
                )}
              </div>

              {draftFeasibility && formValues.monthlyContribution > 0 && !isLinkedEPF && (
                <div className={cn(
                  "p-3 rounded-lg border flex items-start gap-3 mt-4",
                  "bg-muted/40 border-border text-muted-foreground"
                )}>
                  {draftFeasibility.feasible ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground" />
                  )}
                  <div className="text-sm">
                    {draftFeasibility.feasible ? (
                      <p><strong>Feasible:</strong> This contribution fits within your projected available surplus.</p>
                    ) : (
                       <p><strong>Cash Flow Warning:</strong> You will face a shortfall of <span className="text-negative">{formatINR(draftFeasibility.shortfall!.deficit)}</span> in {format(draftFeasibility.shortfall!.date, "MMMM yyyy")} with this schedule. You can still save it, but consider adjusting the amount or dates.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <h3 className="mb-4 text-sm font-semibold">Asset details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {selectedAssetClass === "Direct Equity" && (
                    <>
                      <FormField
                        control={form.control}
                        name="ticker"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Ticker symbol</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. RELIANCE" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="quantity"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Number of shares</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.0001" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="averageBuyPrice"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Average buy price (₹)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                formatWithCommas
                                step="0.01"
                                {...field}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </>
                  )}

                  {selectedAssetClass === "Mutual Funds" && (
                    <>
                      <FormField
                        control={form.control}
                        name="folio"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Folio number</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="quantity"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Units</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.0001" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="averageBuyPrice"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Average NAV (₹)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                formatWithCommas
                                step="0.01"
                                {...field}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </>
                  )}

                  {(selectedAssetClass === "Fixed Deposit" ||
                    selectedAssetClass === "Recurring Deposit") && (
                    <>
                      <FormField
                        control={form.control}
                        name="institution"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Bank / institution</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="interestRate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Deposit rate (%)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="maturityDate"
                        render={({ field }) => (
                          <FormItem className="flex flex-col mt-2.5">
                            <FormLabel>Maturity date</FormLabel>
                            <FormControl>
                              <DatePickerInput
                                optional
                                value={
                                  field.value && field.value !== ""
                                    ? parseISO(field.value)
                                    : undefined
                                }
                                onChange={(d) =>
                                  field.onChange(
                                    d ? format(d, "yyyy-MM-dd") : undefined
                                  )
                                }
                                minDate={new Date()}
                                maxDate={
                                  new Date(
                                    new Date().getFullYear() + 50,
                                    11,
                                    31
                                  )
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}

                  {selectedAssetClass === "Real Estate" && (
                    <>
                      <FormField
                        control={form.control}
                        name="location"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Location</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="area"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Area / Size</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </>
                  )}

                  {(selectedAssetClass === "PPF" ||
                    selectedAssetClass === "Bonds" ||
                    selectedAssetClass === "NPS") && (
                    <>
                      <FormField
                        control={form.control}
                        name="accountNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Account / PRAN number</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="maturityDate"
                        render={({ field }) => (
                          <FormItem className="flex flex-col mt-2.5">
                            <FormLabel>Maturity date</FormLabel>
                            <FormControl>
                              <DatePickerInput
                                optional
                                value={
                                  field.value && field.value !== ""
                                    ? parseISO(field.value)
                                    : undefined
                                }
                                onChange={(d) =>
                                  field.onChange(
                                    d ? format(d, "yyyy-MM-dd") : undefined
                                  )
                                }
                                minDate={new Date()}
                                maxDate={
                                  new Date(
                                    new Date().getFullYear() + 50,
                                    11,
                                    31
                                  )
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}

                  <div className="md:col-span-2">
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Any details..."
                              className="resize-none"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </div>

              <section className="rounded-xl border border-border p-4" aria-labelledby="capital-gain-disposals-heading">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 id="capital-gain-disposals-heading" className="text-sm font-semibold">
                      Realized disposals
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Record completed sales so eligible realized gains can be included in your tax estimate.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <DisposalImportButton
                      existingDisposals={currentDisposals}
                      defaultAssetClass={selectedAssetClass}
                      onImport={(disposals) => disposalFields.append(disposals)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="button-add-disposal"
                      onClick={() => disposalFields.append({
                        id: crypto.randomUUID(),
                        name: "",
                        purchaseDate: "",
                        saleDate: "",
                        costBasis: 0,
                        proceeds: 0,
                        assetType: selectedAssetClass,
                        eligibleExemption: 0,
                        indexedCostBasis: "",
                        grandfatheredValue: "",
                        createdAt: new Date().toISOString(),
                      })}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add disposal
                    </Button>
                  </div>
                </div>

                {disposalFields.fields.length === 0 ? (
                  <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground" data-testid="text-no-disposals">
                    No completed sales recorded for this investment.
                  </p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {importBatches.map((batch) => (
                      <div
                        key={batch.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3"
                        data-testid={`group-import-batch-${batch.id}`}
                      >
                        <div>
                          <p className="text-sm font-medium" data-testid={`text-import-batch-count-${batch.id}`}>
                            Broker import · {batch.indexes.length} {batch.indexes.length === 1 ? "disposal" : "disposals"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {batch.importedAt
                              ? `Imported ${format(new Date(batch.importedAt), "d MMM yyyy, h:mm a")}`
                              : "Imported broker disposals"}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          data-testid={`button-undo-import-batch-${batch.id}`}
                          onClick={() => {
                            disposalFields.remove(
                              disposalImportBatchIndexes(currentDisposals, batch.id),
                            );
                            toast({
                              title: "Broker import removed",
                              description: "Save changes to make this undo permanent.",
                            });
                          }}
                        >
                          <Undo2 className="mr-2 h-4 w-4" />
                          Undo this import
                        </Button>
                      </div>
                    ))}
                    {disposalFields.fields.map((disposal, index) => (
                      <fieldset
                        key={disposal.id}
                        className="rounded-lg border bg-background p-4"
                        data-testid={`group-disposal-${disposal.id}`}
                      >
                        <legend className="px-1 text-sm font-medium">
                          Disposal {index + 1}
                          {currentDisposals[index]?.importBatchId
                            ? ` · Broker import${
                                currentDisposals[index]?.importedAt
                                  ? ` from ${format(new Date(currentDisposals[index].importedAt!), "d MMM yyyy, h:mm a")}`
                                  : ""
                              }`
                            : ""}
                        </legend>
                        <div className="grid gap-4 md:grid-cols-2">
                          <FormField
                            control={form.control}
                            name={`disposals.${index}.name`}
                            render={({ field }) => (
                              <FormItem className="md:col-span-2">
                                <FormLabel>Sale description</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="e.g. Sale of 20 units"
                                    data-testid={`input-disposal-name-${index}`}
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`disposals.${index}.purchaseDate`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Purchase date</FormLabel>
                                <FormControl>
                                  <Input type="date" data-testid={`input-disposal-purchase-date-${index}`} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`disposals.${index}.saleDate`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Sale date</FormLabel>
                                <FormControl>
                                  <Input type="date" data-testid={`input-disposal-sale-date-${index}`} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`disposals.${index}.costBasis`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Cost basis (₹)</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    formatWithCommas
                                    data-testid={`input-disposal-cost-basis-${index}`}
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`disposals.${index}.proceeds`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Sale proceeds (₹)</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    formatWithCommas
                                    data-testid={`input-disposal-proceeds-${index}`}
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`disposals.${index}.assetType`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Asset type</FormLabel>
                                <Select value={field.value} onValueChange={field.onChange}>
                                  <FormControl>
                                    <SelectTrigger data-testid={`select-disposal-asset-type-${index}`}>
                                      <SelectValue placeholder="Select asset type" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {[
                                      "Listed Equity",
                                      "Equity Mutual Fund",
                                      "Unlisted Equity",
                                      "Real Estate",
                                      "Gold",
                                      "Debt Mutual Fund",
                                      "Listed Bonds",
                                      "Crypto",
                                    ].map((assetType) => (
                                      <SelectItem key={assetType} value={assetType}>{assetType}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`disposals.${index}.eligibleExemption`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Eligible exemption (₹)</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    formatWithCommas
                                    data-testid={`input-disposal-exemption-${index}`}
                                    {...field}
                                  />
                                </FormControl>
                                <p className="text-xs text-muted-foreground">
                                  Enter only a supported exemption attributable to this sale.
                                </p>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`disposals.${index}.indexedCostBasis`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Indexed cost basis (₹, optional)</FormLabel>
                                <FormControl>
                                  <Input type="number" min="0" step="0.01" formatWithCommas data-testid={`input-disposal-indexed-cost-${index}`} {...field} />
                                </FormControl>
                                <p className="text-xs text-muted-foreground">
                                  Required for eligible long-term debt-fund, property and similar sales before 23 July 2024.
                                </p>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`disposals.${index}.grandfatheredValue`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Value on 31 Jan 2018 (₹, optional)</FormLabel>
                                <FormControl>
                                  <Input type="number" min="0" step="0.01" formatWithCommas data-testid={`input-disposal-grandfathered-value-${index}`} {...field} />
                                </FormControl>
                                <p className="text-xs text-muted-foreground">
                                  Used only for eligible long-term listed equity or equity-fund units bought before 1 February 2018.
                                </p>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="mt-4 flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            data-testid={`button-remove-disposal-${index}`}
                            onClick={() => disposalFields.remove(index)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove disposal
                          </Button>
                        </div>
                      </fieldset>
                    ))}
                  </div>
                )}
              </section>
              </div>

              <div className="shrink-0 pt-4 mt-4 border-t border-border flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving
                    ? "Saving..."
                    : editingId
                      ? "Save Changes"
                      : "Add Investment"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
