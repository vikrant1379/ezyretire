import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { AlertTriangle, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Checkbox } from "@workspace/wealthone-design-system/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/wealthone-design-system/components/ui/dialog";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { getEntitlements } from "@/lib/feature-api";
import {
  BANK_STATEMENT_LIMITS,
  bankStatementDateInputValue,
  parseBankStatementFile,
  prepareBankStatementCommit,
  type BankStatementReview,
  type BankStatementRow,
} from "@/lib/bank-statement-import";
import { performFinancialCacheUpdate } from "@/hooks/use-financial-write";
import { commitBankStatementImport } from "@/lib/financial-api";
import type { Expense } from "@/lib/storage";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { trackExpenseSaveSucceeded } from "@/lib/expense-analytics";
import {
  capturePrivateQueryGeneration,
  isCurrentPrivateQueryGeneration,
  type PrivateQueryGeneration,
} from "@/lib/query-policy";

type Filter = "all" | "ready" | "duplicates" | "transfers";

export function reviewRowsForFilter(rows: BankStatementRow[], filter: Filter) {
  if (filter === "ready") return rows.filter((row) => !row.duplicate && !row.selfTransfer);
  if (filter === "duplicates") return rows.filter((row) => row.duplicate);
  if (filter === "transfers") return rows.filter((row) => row.selfTransfer);
  return rows;
}

export type AccountBoundBankStatementReview = {
  accountId: string;
  generation: PrivateQueryGeneration;
  review: BankStatementReview;
};

export function reviewForActiveBankStatementAccount(
  bound: AccountBoundBankStatementReview | null,
  accountId: string | null,
  queryClient: QueryClient,
): BankStatementReview | null {
  return bound?.accountId === accountId
    && isCurrentPrivateQueryGeneration(queryClient, bound.generation)
    ? bound.review
    : null;
}

export function BankStatementImport({ expenses, mobile = false }: { expenses: Expense[]; mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const [boundReview, setBoundReview] = useState<AccountBoundBankStatementReview | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();
  const accountId = isAuthenticated ? user?.id ?? null : null;
  const accountGeneration = capturePrivateQueryGeneration(queryClient);
  const activeAccountRef = useRef(accountId);
  activeAccountRef.current = accountId;
  const review = reviewForActiveBankStatementAccount(boundReview, accountId, queryClient);
  const { toast } = useToast();
  const entitlements = useQuery({ queryKey: ["entitlements"], queryFn: getEntitlements, staleTime: 60_000 });
  const allowed = entitlements.data?.capabilities.bankStatementImport === true;
  const visibleRows = useMemo(() => reviewRowsForFilter(review?.rows ?? [], filter), [review, filter]);
  const selectedCount = review?.rows.filter((row) => row.selected).length ?? 0;
  const selectedTotal = review?.rows.reduce((sum, row) => sum + (row.selected ? row.amount : 0), 0) ?? 0;

  useEffect(() => {
    setBoundReview(null);
    setError("");
    setFilter("all");
  }, [accountId, accountGeneration]);

  const update = (id: string, changes: Partial<BankStatementRow>) => {
    if (!boundReview || !review) return;
    setBoundReview({
      ...boundReview,
      review: { ...review, rows: review.rows.map((row) => row.id === id ? { ...row, ...changes } : row) },
    });
  };
  const close = (next: boolean) => {
    if (!next) {
      setBoundReview(null); setError(""); setFilter("all");
    }
    setOpen(next);
  };
  const choose = async (file?: File) => {
    if (!file) return;
    if (!accountId) {
      setError("Sign in again before selecting a statement.");
      return;
    }
    const binding = { accountId, generation: accountGeneration };
    setReading(true); setError(""); setBoundReview(null);
    try {
      const parsed = await parseBankStatementFile(file, expenses);
      if (activeAccountRef.current !== binding.accountId
        || !isCurrentPrivateQueryGeneration(queryClient, binding.generation)) return;
      setBoundReview({ ...binding, review: parsed });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The statement could not be read.");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={mobile ? "ghost" : "outline"}
        className={mobile ? "w-full justify-start" : undefined}
        disabled={entitlements.isLoading || !allowed}
        title={!entitlements.isLoading && !allowed ? "Bank statement import is available on Premium" : undefined}
        onClick={() => setOpen(true)}
        data-testid="button-bank-statement-import"
      >
        <FileSpreadsheet className="mr-2 h-4 w-4" />
        {entitlements.isLoading ? "Checking access…" : "Bank statement"}
        <span className="ml-2 rounded bg-secondary/20 px-1.5 py-0.5 text-[11px] font-bold uppercase">Premium</span>
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Import bank statement</DialogTitle>
            <DialogDescription>
              SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB and IndusInd CSV or text-based PDF. Nothing is saved until you review and confirm.
            </DialogDescription>
          </DialogHeader>
          {!review && <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              CSV limit: 5 MiB. PDF limit: 10 MiB and 5,000 transactions. Password-protected and scanned PDFs are not supported.
            </div>
            <input ref={fileRef} type="file" className="sr-only" accept=".csv,text/csv,.pdf,application/pdf" onChange={(event) => void choose(event.target.files?.[0])} data-testid="input-bank-statement" />
            <Button type="button" onClick={() => fileRef.current?.click()} disabled={reading} className="w-full sm:w-auto">
              {reading ? <><Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" />Reading statement…</> : "Choose statement"}
            </Button>
          </div>}
          {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" data-testid="status-bank-statement-error">{error}</p>}
          {review && <div className="space-y-4" data-testid="bank-statement-review">
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
              <div><span className="text-muted-foreground">Detected bank</span><strong className="block">{review.bank}</strong></div>
              <div><span className="text-muted-foreground">Parser</span><strong className="block">{review.version}</strong></div>
              <div><span className="text-muted-foreground">Confidence</span><strong className="block">{Math.round(review.confidence * 100)}%</strong></div>
              <div><span className="text-muted-foreground">Selected</span><strong className="block">{selectedCount} · ₹{selectedTotal.toLocaleString("en-IN")}</strong></div>
            </div>
            <p className="flex gap-2 rounded-lg bg-warning p-3 text-sm text-warning dark:bg-warning-background dark:text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Compare dates, amounts and categories with the original. Duplicate matches are warnings; likely self-transfer rows start excluded.
            </p>
            {review.issues.length > 0 && <div className="rounded-lg border border-warning/30 bg-warning p-3 text-sm text-warning dark:bg-warning-background dark:text-warning" data-testid="bank-statement-review-issues">
              <p className="font-semibold">{review.issues.length} statement field{review.issues.length === 1 ? "" : "s"} could not be imported</p>
              <ul className="mt-1 list-disc pl-5">
                {review.issues.map((issue, index) => <li key={`${issue.row}-${issue.field}-${index}`}>
                  Row {issue.row}: {issue.message}{issue.value ? ` (${issue.value})` : ""}
                </li>)}
              </ul>
            </div>}
            <div className="flex flex-wrap gap-2" aria-label="Review filters">
              {(["all", "ready", "duplicates", "transfers"] as Filter[]).map((value) => <Button key={value} type="button" size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>{value === "transfers" ? "Self transfers" : value[0].toUpperCase() + value.slice(1)}</Button>)}
            </div>
            <div className="space-y-3">
              {visibleRows.map((row) => <div key={row.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[auto_9rem_8rem_1fr_12rem]" data-testid="bank-statement-row">
                <Checkbox aria-label={`Include ${row.description}`} checked={row.selected} onCheckedChange={(value) => update(row.id, { selected: value === true })} />
                <div><Label className="sr-only" htmlFor={`${row.id}-date`}>Date</Label><Input id={`${row.id}-date`} type="date" value={row.date.slice(0, 10)} onChange={(event) => update(row.id, { date: bankStatementDateInputValue(event.target.value) })} /></div>
                <div><Label className="sr-only" htmlFor={`${row.id}-amount`}>Amount</Label><Input id={`${row.id}-amount`} type="number" min="0.01" step="0.01" value={row.amount} onChange={(event) => update(row.id, { amount: Number(event.target.value) })} /></div>
                <div className="min-w-0"><Label className="sr-only" htmlFor={`${row.id}-merchant`}>Merchant</Label><Input id={`${row.id}-merchant`} maxLength={BANK_STATEMENT_LIMITS.merchant} value={row.merchant} onChange={(event) => update(row.id, { merchant: event.target.value })} /><p className="mt-1 truncate text-xs text-muted-foreground" title={row.description}>{row.description}</p></div>
                <div><Label className="sr-only" htmlFor={`${row.id}-category`}>Category</Label><Input id={`${row.id}-category`} maxLength={BANK_STATEMENT_LIMITS.category} value={row.category} onChange={(event) => update(row.id, { category: event.target.value })} />{(row.duplicate || row.selfTransfer) && <p className="mt-1 text-xs font-medium text-warning">{row.duplicate ? "Possible duplicate" : "Likely self transfer"}</p>}</div>
              </div>)}
              {!visibleRows.length && <p className="py-6 text-center text-sm text-muted-foreground">No transactions match this filter.</p>}
            </div>
            <div className="flex flex-col-reverse justify-between gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setBoundReview(null)}>Choose another file</Button>
              <Button type="button" disabled={!selectedCount} data-testid="button-commit-bank-statement" onClick={() => {
                let reviewedExpenses;
                try {
                  if (reviewForActiveBankStatementAccount(boundReview, activeAccountRef.current, queryClient) !== review) {
                    throw new Error("Your account changed. Select and review the statement again before saving.");
                  }
                  reviewedExpenses = prepareBankStatementCommit(review);
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : "Review the statement before saving.");
                  return;
                }
                void performFinancialCacheUpdate(
                  queryClient,
                  () => commitBankStatementImport(reviewedExpenses, boundReview!.accountId),
                  (_current, result) => result.data,
                ).then(({ added, duplicateCount }) => {
                    if (added.length) trackExpenseSaveSucceeded("import");
                    toast({ title: "Bank statement imported", description: `Saved ${added.length} expenses.${duplicateCount ? ` Skipped ${duplicateCount} duplicates.` : ""}` });
                    close(false);
                  }).catch((reason) => setError(reason instanceof Error ? reason.message : "The reviewed transactions could not be saved. Nothing was imported; please retry."));
              }}>{`Save ${selectedCount} reviewed expenses`}</Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
