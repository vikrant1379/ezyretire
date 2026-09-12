import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, FileUp, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Checkbox } from "@workspace/wealthone-design-system/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/wealthone-design-system/components/ui/dialog";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { analyzeReceipt, confirmReceiptReview, discardReceiptReview, getEntitlements, type ConfirmedReceiptExpense, type ReceiptDraft } from "@/lib/feature-api";
import { useAllCategories } from "@/lib/categories";
import { performFinancialCacheUpdate } from "@/hooks/use-financial-write";
import { type Expense } from "@/lib/storage";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import type { FinancialData } from "@/lib/financial-api";

export function mergeConfirmedReceiptExpense(
  current: FinancialData,
  result: { expense: ConfirmedReceiptExpense; cleanupPending: boolean },
): FinancialData {
  const amount = typeof result.expense.amount === "number"
    ? result.expense.amount
    : result.expense.amount.trim()
      ? Number(result.expense.amount)
      : Number.NaN;
  if (!Number.isFinite(amount)) {
    throw new Error("The confirmed receipt returned an invalid expense amount");
  }
  const confirmedExpense: Expense = {
    ...result.expense,
    amount,
    note: result.expense.note ?? undefined,
  };
  return {
    ...current,
    expenses: current.expenses.some((expense) => expense.id === confirmedExpense.id)
      ? current.expenses.map((expense) => expense.id === confirmedExpense.id ? confirmedExpense : expense)
      : [...current.expenses, confirmedExpense],
  };
}

export async function publishReceiptExtraction(
  file: File,
  signal: AbortSignal,
  publish: (draft: ReceiptDraft) => void,
  analyze: typeof analyzeReceipt = analyzeReceipt,
  discard: typeof discardReceiptReview = discardReceiptReview,
): Promise<boolean> {
  const result = await analyze(file, signal);
  if (signal.aborted) {
    await discard(result.reviewId).catch(() => undefined);
    return false;
  }
  publish(result);
  return true;
}

export function ReceiptExpenseImport({ onUseDraft }: { onUseDraft: (draft: ReceiptDraft) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const extractionRef = useRef<AbortController | null>(null);
  const categories = useAllCategories();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const entitlements = useQuery({ queryKey: ["entitlements"], queryFn: getEntitlements, staleTime: 60_000 });
  const canScan = entitlements.data?.capabilities.receiptOcr === true;

  const choose = async (file?: File) => {
    if (!file) return;
    extractionRef.current?.abort();
    const controller = new AbortController();
    extractionRef.current = controller;
    setLoading(true);
    setError("");
    setConfirmed(false);
    try {
      await publishReceiptExtraction(file, controller.signal, setDraft);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "The receipt could not be read");
      }
    } finally {
      if (extractionRef.current === controller) {
        extractionRef.current = null;
        setLoading(false);
      }
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const updateLine = (index: number, key: "description" | "amount", value: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      lineItems: draft.lineItems.map((line, lineIndex) => lineIndex === index
        ? { ...line, [key]: key === "amount" ? Number(value) : value }
        : line),
    });
    setConfirmed(false);
  };
  const valid = Boolean(draft?.merchant.trim() && draft.amount > 0 && draft.date && draft.category);
  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      extractionRef.current?.abort();
      extractionRef.current = null;
      setLoading(false);
    }
    if (!nextOpen && draft?.reviewId) void discardReceiptReview(draft.reviewId);
    if (!nextOpen) setDraft(null);
    setOpen(nextOpen);
  };

  return (
    <>
      <Button type="button" variant="outline" className="gap-2" disabled={!canScan} title={!entitlements.isLoading && !canScan ? "Receipt scanning is available on Premium" : undefined} onClick={() => setOpen(true)} data-testid="button-scan-receipt">
        <Sparkles className="h-4 w-4" />{entitlements.isLoading ? "Checking receipt access…" : canScan ? "Scan receipt" : "Receipt scan"} <span className="rounded bg-secondary/20 px-1.5 py-0.5 text-[11px] font-bold uppercase">Premium</span>
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import a receipt</DialogTitle>
            <DialogDescription>Take a clear photo or choose a file. Nothing is added until you review and confirm every detail.</DialogDescription>
          </DialogHeader>
          {!draft && <div className="grid gap-3 sm:grid-cols-2">
            <input ref={cameraRef} className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => void choose(event.target.files?.[0])} data-testid="input-receipt-camera" />
            <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void choose(event.target.files?.[0])} data-testid="input-receipt-file" />
            <Button type="button" variant="outline" className="h-24 flex-col gap-2" disabled={loading} onClick={() => cameraRef.current?.click()} data-testid="button-take-receipt-photo"><Camera className="h-6 w-6" />Take photo</Button>
            <Button type="button" variant="outline" className="h-24 flex-col gap-2" disabled={loading} onClick={() => fileRef.current?.click()} data-testid="button-choose-receipt-file"><FileUp className="h-6 w-6" />Choose file</Button>
          </div>}
          {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 motion-safe:animate-spin" />Reading receipt securely…</p>}
          {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" data-testid="status-receipt-error">{error}</p>}
          {draft && <div className="space-y-4">
            <p className="rounded-lg bg-warning p-3 text-sm text-warning dark:bg-warning-background dark:text-warning">Automated extraction can be wrong. Compare these fields with your receipt.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="receipt-merchant">Merchant</Label><Input id="receipt-merchant" value={draft.merchant} onChange={(e) => { setDraft({ ...draft, merchant: e.target.value }); setConfirmed(false); }} data-testid="input-receipt-merchant" /></div>
              <div><Label htmlFor="receipt-amount">Total amount (₹)</Label><Input id="receipt-amount" type="number" min="0.01" step="0.01" value={draft.amount} onChange={(e) => { setDraft({ ...draft, amount: Number(e.target.value) }); setConfirmed(false); }} data-testid="input-receipt-amount" /></div>
              <div><Label htmlFor="receipt-date">Date</Label><Input id="receipt-date" type="date" value={draft.date.slice(0, 10)} onChange={(e) => { setDraft({ ...draft, date: e.target.value }); setConfirmed(false); }} data-testid="input-receipt-date" /></div>
              <div><Label htmlFor="receipt-category">Category</Label><Select value={draft.category} onValueChange={(category) => { setDraft({ ...draft, category }); setConfirmed(false); }}><SelectTrigger id="receipt-category" data-testid="select-receipt-category"><SelectValue /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-sm font-semibold">Line items</legend>
              {draft.lineItems.map((line, index) => <div key={index} className="grid grid-cols-[1fr_7rem_auto] gap-2">
                <Input aria-label={`Line item ${index + 1} description`} value={line.description} onChange={(e) => updateLine(index, "description", e.target.value)} data-testid={`input-receipt-line-description-${index}`} />
                <Input aria-label={`Line item ${index + 1} amount`} type="number" min="0" step="0.01" value={line.amount} onChange={(e) => updateLine(index, "amount", e.target.value)} data-testid={`input-receipt-line-amount-${index}`} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove line item ${index + 1}`} onClick={() => { setDraft({ ...draft, lineItems: draft.lineItems.filter((_, i) => i !== index) }); setConfirmed(false); }} data-testid={`button-remove-receipt-line-${index}`}><Trash2 className="h-4 w-4" /></Button>
              </div>)}
              <Button type="button" variant="ghost" size="sm" onClick={() => { setDraft({ ...draft, lineItems: [...draft.lineItems, { description: "", amount: 0 }] }); setConfirmed(false); }} data-testid="button-add-receipt-line"><Plus className="mr-2 h-4 w-4" />Add line</Button>
            </fieldset>
            <label className="flex items-start gap-3 rounded-lg border p-3 text-sm"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} data-testid="checkbox-confirm-receipt" /><span>I compared the merchant, date, total, category and line items with the original receipt.</span></label>
            <label className="flex items-start gap-3 rounded-lg border p-3 text-sm"><Checkbox checked={keepOriginal} onCheckedChange={(value) => setKeepOriginal(value === true)} data-testid="checkbox-keep-original-receipt" /><span>Keep the original receipt in my secure vault (optional).</span></label>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => { extractionRef.current?.abort(); extractionRef.current = null; if (draft.reviewId) void discardReceiptReview(draft.reviewId); setDraft(null); setKeepOriginal(false); }} data-testid="button-replace-receipt">Use another file</Button>
              <Button type="button" disabled={!valid || !confirmed || confirming} onClick={async () => {
                setConfirming(true);
                setError("");
                try {
                  const result = await performFinancialCacheUpdate(
                    queryClient,
                    () => confirmReceiptReview(draft, keepOriginal),
                    mergeConfirmedReceiptExpense,
                  );
                  void queryClient.invalidateQueries({ queryKey: ["vault-cleanup-status"] });
                  if (result.cleanupPending) {
                    toast({
                      title: "Expense saved; private cleanup pending",
                      description: "Your expense is saved. Deletion of the private receipt file is still in progress.",
                    });
                  }
                  onUseDraft(draft);
                  setOpen(false);
                  setDraft(null);
                  setKeepOriginal(false);
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : "The receipt review could not be confirmed");
                } finally {
                  setConfirming(false);
                }
              }} data-testid="button-use-receipt-draft">{confirming ? "Confirming…" : "Use confirmed details"}</Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
