import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { formatDateOnly, parseDateOnly, type FinancialReminder } from "@/lib/storage";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@workspace/wealthone-design-system/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@workspace/wealthone-design-system/components/ui/form";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { DatePickerInput } from "@workspace/wealthone-design-system/components/ui/date-picker-input";
import { financialWriteErrorDescription, useFinancialWrite } from "@/hooks/use-financial-write";
import { Switch } from "@workspace/wealthone-design-system/components/ui/switch";
import { createDraftIdentity, runSingleSubmission } from "@/lib/form-submission";

const reminderSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160, "Title must be 160 characters or fewer"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
  amount: z.coerce.number().min(0, "Amount cannot be negative").optional(),
  recurrence: z.enum(["none", "monthly", "yearly"]),
  enabled: z.boolean(),
  notes: z.string().max(1000, "Notes must be 1,000 characters or fewer").optional(),
});

type ReminderFormValues = z.infer<typeof reminderSchema>;

export function ReminderFormDialog({
  reminder,
  children,
  isOpen,
  setIsOpen
}: {
  reminder?: FinancialReminder;
  children?: React.ReactNode;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}) {
  const write = useFinancialWrite({ showErrorToast: false });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionGate = useRef(false);
  const draftIdentity = useRef(createDraftIdentity());

  const form = useForm<ReminderFormValues>({
    resolver: zodResolver(reminderSchema),
    defaultValues: reminder ? {
      title: reminder.title,
      date: reminder.date,
      amount: reminder.amount,
      recurrence: reminder.recurrence,
      enabled: reminder.enabled,
      notes: reminder.notes || "",
    } : {
      title: "",
      date: "",
      amount: undefined,
      recurrence: "none",
      enabled: true,
      notes: "",
    }
  });

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (!reminder) {
        draftIdentity.current = createDraftIdentity();
        form.reset();
      } else {
        form.reset({
          title: reminder.title,
          date: reminder.date,
          amount: reminder.amount,
          recurrence: reminder.recurrence,
          enabled: reminder.enabled,
          notes: reminder.notes || "",
        });
      }
    }
  }, [isOpen, reminder, form]);

  const onSubmit = async (values: ReminderFormValues) => {
    if (submissionGate.current) return;
    setError(null);
    try {
      await runSingleSubmission(submissionGate, async () => {
        setIsSaving(true);
        try {
          await write((current) => {
          const reminders = [...current.reminders];
          if (reminder) {
            const index = reminders.findIndex(r => r.id === reminder.id);
            if (index !== -1) {
              reminders[index] = { ...reminder, ...values };
            }
          } else if (!reminders.some((item) => item.id === draftIdentity.current.id)) {
            reminders.push({
              ...draftIdentity.current,
              ...values,
            });
          }
          return { ...current, reminders };
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
          <DialogTitle>{reminder ? "Edit Reminder" : "Add Reminder"}</DialogTitle>
          <DialogDescription>
            Schedule a custom financial event or reminder.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="rounded-md bg-muted/40 border border-border/50 p-3 text-sm font-medium text-foreground">
            {error}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Pay property tax" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
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
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (Optional)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="recurrence"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Recurrence</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select recurrence" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">One-time</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional details..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Enabled</FormLabel>
                    <FormDescription>
                      Show this reminder on your calendar
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

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
