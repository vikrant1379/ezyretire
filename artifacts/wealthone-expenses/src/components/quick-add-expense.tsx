import { useState } from "react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
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

export const PAYMENT_METHODS = [
  "UPI",
  "Credit Card",
  "Debit Card",
  "Net Banking",
  "Cash",
];

export function QuickAddExpense({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const addExpense = useAddExpense();
  const { data: loans = [] } = useLoans();
  const { toast } = useToast();

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
      {
        onSuccess: () => {
          toast({
            title: "Expense added",
            description: "Your expense has been successfully recorded.",
          });
          setOpen(false);
          setAmount("");
          setCategory("");
          setMerchant("");
          setNote("");
          setReimbursable(false);
          setDate(new Date());
          setEmiChoice(null);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className={cn("gap-2 rounded-full shadow-sm", className)}>
          <Plus className="h-4 w-4" />
          Add Expense
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden border-0 shadow-2xl">
        <div className="px-6 py-6 bg-muted/30 border-b border-border">
          <DialogHeader>
            <DialogTitle className="text-2xl font-serif">Add Expense</DialogTitle>
            <DialogDescription>
              Quickly record a new transaction.
            </DialogDescription>
          </DialogHeader>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-5 bg-card">
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

            <div className="space-y-2 col-span-2">
              <Label htmlFor="note" className="text-muted-foreground font-medium text-xs uppercase tracking-wider">Note</Label>
              <Input
                id="note"
                placeholder="Optional details"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-11"
              />
            </div>

            <div className="flex items-center space-x-2 col-span-2 pt-2">
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
          </div>

          <div className="pt-4 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
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
