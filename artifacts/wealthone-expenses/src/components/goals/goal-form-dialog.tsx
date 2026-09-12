import { useState, useEffect, useRef, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { formatDateOnly, parseDateOnly, type FinancialGoal } from "@/lib/storage";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@workspace/wealthone-design-system/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@workspace/wealthone-design-system/components/ui/form";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { DatePickerInput } from "@workspace/wealthone-design-system/components/ui/date-picker-input";
import { financialWriteErrorDescription, useFinancialWrite } from "@/hooks/use-financial-write";
import { createDraftIdentity, runSingleSubmission } from "@/lib/form-submission";
import { canSaveGoalAllocation } from "@/lib/goals";

const goalSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160, "Name must be 160 characters or fewer"),
  targetAmount: z.coerce.number().min(1, "Target amount must be positive"),
  currentAmount: z.coerce.number().min(0),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
  priority: z.coerce.number().min(1),
  annualInflationRate: z.coerce.number().min(0).max(25),
  monthlyAllocation: z.coerce.number().min(0),
});

type GoalFormValues = z.infer<typeof goalSchema>;

export function GoalFormDialog({
  goal,
  children,
  availableSurplus,
  currentCommitted,
  isOpen,
  setIsOpen
}: {
  goal?: FinancialGoal;
  children?: React.ReactNode;
  availableSurplus: number;
  currentCommitted: number;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}) {
  const write = useFinancialWrite({ showErrorToast: false });
  const [error, setError] = useState<ReactNode>(null);
  const [isSaving, setIsSaving] = useState(false);
  const submissionGate = useRef(false);
  const draftIdentity = useRef(createDraftIdentity());

  const form = useForm<GoalFormValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: goal ? {
      name: goal.name,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      targetDate: goal.targetDate,
      priority: goal.priority,
      annualInflationRate: goal.annualInflationRate,
      monthlyAllocation: goal.monthlyAllocation,
    } : {
      name: "",
      targetAmount: 100000,
      currentAmount: 0,
      targetDate: "",
      priority: 1,
      annualInflationRate: 6,
      monthlyAllocation: 0,
    }
  });

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (!goal) {
        draftIdentity.current = createDraftIdentity();
        form.reset();
      } else {
        form.reset({
          name: goal.name,
          targetAmount: goal.targetAmount,
          currentAmount: goal.currentAmount,
          targetDate: goal.targetDate,
          priority: goal.priority,
          annualInflationRate: goal.annualInflationRate,
          monthlyAllocation: goal.monthlyAllocation,
        });
      }
    }
  }, [isOpen, goal, form]);

  const onSubmit = async (values: GoalFormValues) => {
    if (submissionGate.current) return;
    if (!canSaveGoalAllocation({
      otherCommitted: currentCommitted,
      previousAllocation: goal?.monthlyAllocation,
      nextAllocation: values.monthlyAllocation,
      availableSurplus,
    })) {
      const remaining = Math.max(0, availableSurplus - currentCommitted);
      setError(
        <>
          This would exceed your available confirmed surplus. You have{" "}
          <span className={remaining > 0 ? "text-warning" : "text-foreground"}>
            {remaining.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
          </span>{" "}
          remaining per month.
        </>,
      );
      return;
    }
    
    setError(null);
    try {
      await runSingleSubmission(submissionGate, async () => {
        setIsSaving(true);
        try {
          await write((current) => {
          const goals = [...current.goals];
          if (goal) {
            const index = goals.findIndex(g => g.id === goal.id);
            if (index !== -1) {
              goals[index] = { ...goal, ...values };
            }
          } else if (!goals.some((item) => item.id === draftIdentity.current.id)) {
            goals.push({
              ...draftIdentity.current,
              ...values,
            });
          }
          return { ...current, goals };
        });
          setIsOpen(false);
        } finally {
          setIsSaving(false);
        }
      });
    } catch (saveError) {
      setError(`${financialWriteErrorDescription(saveError)} Your draft is still here—review it and try again.`);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!isSaving) setIsOpen(open); }}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit Goal" : "Add Goal"}</DialogTitle>
          <DialogDescription>
            Plan your next financial milestone.
          </DialogDescription>
        </DialogHeader>
        
        {error && (
          <div className="text-sm font-medium text-foreground bg-muted/40 border border-border/50 p-3 rounded-md">
            {error}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Dream Vacation" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="targetAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Amount</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currentAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Saved So Far</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="targetDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Date</FormLabel>
                    <FormControl>
                      <DatePickerInput 
                        value={field.value ? parseDateOnly(field.value) : undefined} 
                        onChange={(date) => field.onChange(date ? formatDateOnly(date) : "")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="annualInflationRate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Inflation Rate (%)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="monthlyAllocation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Allocation</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority (1 = Highest)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isSaving}>Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
