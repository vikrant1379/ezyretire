import { useEffect, useRef, useState } from "react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@workspace/wealthone-design-system/components/ui/dialog";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/wealthone-design-system/components/ui/select";
import { useAddExpense } from "@/hooks/use-expenses";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { Plus } from "lucide-react";
import { Checkbox } from "@workspace/wealthone-design-system/components/ui/checkbox";
import { DatePickerInput } from "@workspace/wealthone-design-system/components/ui/date-picker-input";
import { useLoans } from "@/hooks/use-loans";
import { findMatchingEmiLoan } from "@/lib/storage";
import { Alert, AlertDescription, AlertTitle } from "@workspace/wealthone-design-system/components/ui/alert";
import { AlertTriangle } from "lucide-react";

import { useAllCategories } from "@/lib/categories";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { trackEvent } from "@/lib/analytics";
import { trackExpenseSaveSucceeded } from "@/lib/expense-analytics";
import { useQueryClient } from "@tanstack/react-query";
import { ReceiptExpenseImport } from "@/components/receipt-expense-import";

type QuickAddExpenseMutationCallbacksDependencies = {
  emiChoiceRequired: boolean;
  trackSuccess?: typeof trackExpenseSaveSucceeded;
  completeSession?: () => void;
  showSuccess: () => void;
  closeAndReset: () => void;
};

type QuickAddExpenseAnalyticsSessionDependencies = {
  track?: typeof trackEvent;
};

export function createQuickAddExpenseAnalyticsSession({
  track = trackEvent,
}: QuickAddExpenseAnalyticsSessionDependencies = {}) {
  let active = false;
  let emiChoiceRequired = false;

  return {
    open() {
      if (active) return;

      active = true;
      emiChoiceRequired = false;
      track("expense_dialog_opened");
    },
    requireEmiChoice() {
      if (active) emiChoiceRequired = true;
    },
    complete() {
      active = false;
    },
    cancel() {
      if (!active) return;

      active = false;
      track("expense_dialog_cancelled", {
        emi_choice_required: emiChoiceRequired,
      });
    },
    isEmiChoiceRequired() {
      return emiChoiceRequired;
    },
  };
}

export function createQuickAddExpenseMutationCallbacks({
  emiChoiceRequired,
  trackSuccess = trackExpenseSaveSucceeded,
  completeSession,
  showSuccess,
  closeAndReset,
}: QuickAddExpenseMutationCallbacksDependencies) {
  return {
    onSuccess: (_persistedExpense?: unknown) => {
      trackSuccess("create", emiChoiceRequired);
      completeSession?.();
      showSuccess();
      closeAndReset();
    },
  };
}

export const PAYMENT_METHODS = [
  "UPI",
  "Credit Card",
  "Debit Card",
  "Net Banking",
  "Cash",
];

export function QuickAddExpense({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const analyticsSession = useRef(createQuickAddExpenseAnalyticsSession());
  const addExpense = useAddExpense();
  const { data: loans = [] } = useLoans();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [merchant, setMerchant] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("UPI");
  const [note, setNote] = useState("");
  const [reimbursable, setReimbursable] = useState(false);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [emiChoice, setEmiChoice] = useState<"loan-emi" | "separate" | null>(null);
  const categories = useAllCategories();
  const matchingLoan = findMatchingEmiLoan({
    amount: Number(amount),
    merchant,
    note,
  }, loans, false);

  useEffect(() => {
    if (open && matchingLoan) {
      analyticsSession.current.requireEmiChoice();
    }
  }, [matchingLoan, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      analyticsSession.current.open();
    } else {
      analyticsSession.current.cancel();
    }

    setOpen(nextOpen);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !category || !date || (matchingLoan && !emiChoice)) return;

    addExpense.mutate(
      {
        amount: Number(amount),
        category,
        merchant: merchant || "Unknown",
        paymentMethod,
        note,
        reimbursable,
        recurring: false,
        linkedLoanId: emiChoice === "loan-emi" ? matchingLoan?.id : undefined,
        date: date.toISOString(),
      },
      createQuickAddExpenseMutationCallbacks({
        emiChoiceRequired: analyticsSession.current.isEmiChoiceRequired(),
        completeSession: () => analyticsSession.current.complete(),
        showSuccess: () => {
          toast({
            title: "Expense added",
            description: "Your expense has been successfully recorded.",
          });
        },
        closeAndReset: () => {
          setOpen(false);
          setAmount("");
          setCategory("");
          setMerchant("");
          setNote("");
          setReimbursable(false);
          setDate(new Date());
          setEmiChoice(null);
        },
      }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className={cn("gap-2 rounded-full shadow-sm", className)}>
          <Plus className="h-4 w-4" />
          Add Expense
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden border-0 p-0 shadow-2xl sm:max-w-[425px]">
        <DialogTitle className="sr-only">Add Expense</DialogTitle>
        <form onSubmit={handleSubmit} className="min-h-0 space-y-5 overflow-y-auto bg-card px-5 pb-5 pt-10 sm:px-6 sm:pb-6 sm:pt-10">
          <fieldset className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-primary">
              Essential details
            </legend>
            <ReceiptExpenseImport onUseDraft={() => {
              analyticsSession.current.complete();
              setOpen(false);
              toast({
                title: "Receipt expense confirmed",
                description: "The confirmed receipt review was saved and is ready for your next financial save.",
              });
            }} />
            <div className="space-y-2">
              <Label htmlFor="amount" className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Amount (₹) *</Label>
              <Input
                id="amount"
                type="number"
                formatWithCommas
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setEmiChoice(null);
                }}
                className="text-lg font-semibold h-12"
                autoFocus
                required
                min="0.01"
                step="0.01"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category" className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Category *</Label>
              <Select value={category} onValueChange={setCategory} required>
                <SelectTrigger id="category" className="h-11">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Date *</Label>
              <DatePickerInput
                value={date}
                onChange={setDate}
                minDate={new Date(new Date().getFullYear() - 10, 0, 1)}
                maxDate={new Date(new Date().getFullYear() + 1, 11, 31)}
              />
            </div>
          </fieldset>

          {matchingLoan && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Possible duplicate loan EMI</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  This amount matches the {matchingLoan.name} EMI. Retirement already accounts for that EMI.
                </p>
                <div className="flex flex-col gap-2">
                  <Button type="button" size="sm" variant={emiChoice === "loan-emi" ? "default" : "outline"} onClick={() => setEmiChoice("loan-emi")}>
                    This is the tracked EMI
                  </Button>
                  <Button type="button" size="sm" variant={emiChoice === "separate" ? "default" : "outline"} onClick={() => setEmiChoice("separate")}>
                    This is a separate expense
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <legend className="col-span-full mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Optional transaction details
            </legend>
            <div className="space-y-2">
              <Label htmlFor="merchant" className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Merchant</Label>
              <Input
                id="merchant"
                placeholder="e.g. Swiggy"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment" className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger id="payment" className="h-11">
                  <SelectValue placeholder="Method" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="note" className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Note</Label>
              <Input
                id="note"
                placeholder="Optional details"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="flex items-center space-x-2 pt-2 sm:col-span-2">
              <Checkbox
                id="reimbursable"
                checked={reimbursable}
                onCheckedChange={(checked) => setReimbursable(checked as boolean)}
              />
              <label
                htmlFor="reimbursable"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Mark as Reimbursable
              </label>
            </div>
          </fieldset>

          <div className="pt-4 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              className="mr-2"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!amount || !category || !date || (matchingLoan && !emiChoice) || addExpense.isPending}>
              {addExpense.isPending ? "Saving..." : "Save Expense"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
