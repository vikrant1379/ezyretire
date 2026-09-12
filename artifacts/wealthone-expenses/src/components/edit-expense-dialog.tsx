import { useState, useEffect } from "react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { useUpdateExpense } from "@/hooks/use-expenses";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { Checkbox } from "@workspace/wealthone-design-system/components/ui/checkbox";
import type { Expense } from "@/lib/storage";
import { PAYMENT_METHODS } from "./quick-add-expense";
import { useAllCategories } from "@/lib/categories";
import { DatePickerInput } from "@workspace/wealthone-design-system/components/ui/date-picker-input";
import { useLoans } from "@/hooks/use-loans";
import { findMatchingEmiLoan } from "@/lib/storage";
import { Alert, AlertDescription, AlertTitle } from "@workspace/wealthone-design-system/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { trackExpenseSaveSucceeded } from "@/lib/expense-analytics";

type ExpenseEditMutationCallbacksDependencies = {
  trackSuccess?: typeof trackExpenseSaveSucceeded;
  showSuccess: () => void;
  closeDialog: () => void;
};

export function createExpenseEditMutationCallbacks({
  trackSuccess = trackExpenseSaveSucceeded,
  showSuccess,
  closeDialog,
}: ExpenseEditMutationCallbacksDependencies) {
  return {
    onSuccess: () => {
      trackSuccess("edit");
      showSuccess();
      closeDialog();
    },
  };
}

export function EditExpenseDialog({
  expense,
  open,
  onOpenChange,
}: {
  expense: Expense | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateExpense = useUpdateExpense();
  const { data: loans = [] } = useLoans();
  const { toast } = useToast();

  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [merchant, setMerchant] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [note, setNote] = useState("");
  const [reimbursable, setReimbursable] = useState(false);
  const [date, setDate] = useState<Date | undefined>();
  const [emiChoice, setEmiChoice] = useState<"loan-emi" | "separate" | null>(null);
  const categories = useAllCategories();
  const matchingLoan = findMatchingEmiLoan({
    amount: Number(amount),
    merchant,
    note,
    linkedLoanId: emiChoice === "loan-emi" ? expense?.linkedLoanId : undefined,
  }, loans, false);

  useEffect(() => {
    if (expense && open) {
      setAmount(expense.amount.toString());
      setCategory(expense.category);
      setMerchant(expense.merchant);
      setPaymentMethod(expense.paymentMethod);
      setNote(expense.note || "");
      setReimbursable(expense.reimbursable);
      setDate(new Date(expense.date));
      setEmiChoice(expense.linkedLoanId ? "loan-emi" : null);
    }
  }, [expense, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !category || !expense || !date || (matchingLoan && !emiChoice)) return;

    updateExpense.mutate(
      {
        ...expense,
        amount: Number(amount),
        category,
        merchant: merchant || "Unknown",
        paymentMethod,
        note,
        reimbursable,
        linkedLoanId: emiChoice === "loan-emi" ? matchingLoan?.id : undefined,
        date: date.toISOString(),
      },
      createExpenseEditMutationCallbacks({
        showSuccess: () => {
          toast({
            title: "Expense updated",
            description: "Your changes have been saved.",
          });
        },
        closeDialog: () => onOpenChange(false),
      }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 p-0 shadow-2xl sm:max-w-[425px]">
        <div className="shrink-0 border-b border-border bg-muted/30 px-6 py-6">
          <DialogHeader>
            <DialogTitle className="text-2xl font-serif">Edit Expense</DialogTitle>
            <DialogDescription>
              Make changes to this transaction.
            </DialogDescription>
          </DialogHeader>
        </div>
        <form onSubmit={handleSubmit} className="min-h-0 space-y-5 overflow-y-auto overscroll-contain bg-card px-6 py-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Date *</Label>
              <DatePickerInput
                value={date}
                onChange={setDate}
                minDate={new Date(new Date().getFullYear() - 10, 0, 1)}
                maxDate={new Date(new Date().getFullYear() + 1, 11, 31)}
              />
            </div>

            <div className="space-y-2 col-span-2">
              <Label htmlFor="edit-amount" className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Amount (₹) *</Label>
              <Input
                id="edit-amount"
                type="number"
                formatWithCommas
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setEmiChoice(null);
                }}
                className="text-lg font-semibold h-12"
                required
                min="0.01"
                step="0.01"
              />
            </div>

            {matchingLoan && (
              <Alert className="col-span-2">
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
            
            <div className="space-y-2 col-span-2">
              <Label htmlFor="edit-category" className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Category *</Label>
              <Select value={category} onValueChange={setCategory} required>
                <SelectTrigger id="edit-category" className="h-11">
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
              <Label htmlFor="edit-merchant" className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Merchant</Label>
              <Input
                id="edit-merchant"
                placeholder="e.g. Swiggy"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-payment" className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger id="edit-payment" className="h-11">
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

            <div className="space-y-2 col-span-2">
              <Label htmlFor="edit-note" className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Note</Label>
              <Input
                id="edit-note"
                placeholder="Optional details"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="flex items-center space-x-2 col-span-2 pt-2">
              <Checkbox
                id="edit-reimbursable"
                checked={reimbursable}
                onCheckedChange={(checked) => setReimbursable(checked as boolean)}
              />
              <label
                htmlFor="edit-reimbursable"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Mark as Reimbursable
              </label>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="mr-2"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!amount || !category || !date || (matchingLoan && !emiChoice) || updateExpense.isPending}>
              {updateExpense.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
