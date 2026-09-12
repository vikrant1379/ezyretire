import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  loadWebPushConfiguration,
  removePushSubscription,
  savePushSubscription,
  type FinancialData,
} from "@/lib/financial-api";
import {
  budgetTotalForMonth,
  calculateTargetRetirementMonth,
  formatDateOnly,
  type NotificationPreferences,
  type NotificationType,
} from "@/lib/storage";
import { useFinancialOperation, useFinancialWrite } from "@/hooks/use-financial-write";
import { decideNotifications } from "@/lib/notifications";
import { generateFinancialCalendar } from "@/lib/financial-calendar";
import { calculateRetirementProjection } from "@/lib/retirement-projection";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@workspace/wealthone-design-system/components/ui/form";
import { Switch } from "@workspace/wealthone-design-system/components/ui/switch";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { Bell, Mail, Smartphone } from "lucide-react";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";

const notificationTypes: Array<{
  id: NotificationType;
  label: string;
  description: string;
}> = [
  { id: "budget", label: "Budget alerts", description: "When spending exceeds this month’s budget." },
  { id: "goal", label: "Goal progress", description: "When a goal falls behind or becomes overdue." },
  { id: "upcoming", label: "Upcoming events", description: "Reminders for scheduled cash flows in the next seven days." },
  { id: "milestone", label: "Milestones", description: "When your portfolio crosses a 25% milestone." },
  { id: "retirement", label: "Retirement", description: "When modeled contributions are below your retirement plan." },
  { id: "tax", label: "Tax deadlines", description: "When an upcoming advance-tax date is near." },
  { id: "anomaly", label: "Unusual expenses", description: "When an expense is materially above your recent average." },
];

const digestDays = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

type PushStatus =
  | "unsupported"
  | "unconfigured"
  | "default"
  | "granted"
  | "denied"
  | "subscribed";

function base64UrlBytes(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const decoded = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function nextTaxDeadline(today: string) {
  const year = Number(today.slice(0, 4));
  return [
    `${year}-03-15`,
    `${year}-06-15`,
    `${year}-09-15`,
    `${year}-12-15`,
    `${year + 1}-03-15`,
  ].find((deadline) => deadline >= today);
}

export function NotificationsView({ data }: { data: FinancialData }) {
  const write = useFinancialWrite();
  const performOperation = useFinancialOperation();
  const { toast } = useToast();
  const [evaluationTime] = useState(() => new Date());
  const [pushPublicKey, setPushPublicKey] = useState<string>();
  const [pushStatus, setPushStatus] = useState<PushStatus>("unsupported");
  const form = useForm<NotificationPreferences>({
    defaultValues: data.notificationPreferences,
  });

  useEffect(() => {
    form.reset(data.notificationPreferences);
  }, [data.notificationPreferences, form]);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushStatus("unsupported");
      return;
    }
    void loadWebPushConfiguration()
      .then(async (configuration) => {
        if (!configuration.supported) {
          setPushStatus("unconfigured");
          return;
        }
        setPushPublicKey(configuration.publicKey);
        const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription && data.notificationPreferences.push) {
          const json = subscription.toJSON();
          if (json.endpoint && json.keys?.p256dh && json.keys.auth) {
            await savePushSubscription({
              endpoint: json.endpoint,
              p256dh: json.keys.p256dh,
              auth: json.keys.auth,
              ...(json.expirationTime ? { expirationTime: json.expirationTime } : {}),
            });
          }
        }
        setPushStatus(subscription ? "subscribed" : Notification.permission);
      })
      .catch(() => setPushStatus("unconfigured"));
  }, [data.notificationPreferences.push]);

  const decidedNotifications = useMemo(() => {
    const today = formatDateOnly(evaluationTime);
    const month = today.slice(0, 7);
    const through = new Date(
      evaluationTime.getFullYear(),
      evaluationTime.getMonth(),
      evaluationTime.getDate() + 30,
    );
    const currentExpenses = data.expenses.filter((expense) => expense.date.startsWith(month));
    const spent = currentExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    const average = currentExpenses.length > 1 ? spent / currentExpenses.length : 0;
    const anomalousExpense = currentExpenses
      .filter((expense) => expense.amount >= Math.max(5_000, average * 2))
      .sort((left, right) => right.amount - left.amount)[0];
    const currentPortfolioValue = data.investments.reduce(
      (sum, investment) => sum + investment.currentValue,
      0,
    );
    const totalInvested = data.investments.reduce(
      (sum, investment) => sum + investment.investedAmount,
      0,
    );
    const projection = calculateRetirementProjection({
      expenses: data.expenses,
      budgets: data.budgets,
      incomes: data.incomeSources,
      investments: data.investments,
      loans: data.loans,
      plannedExpenses: data.plannedExpenses,
      emergencyFund: data.emergencyFund,
      assumptions: {
        ...data.retirementInputs,
        dateOfBirth: data.profileInputs.dateOfBirth,
      },
      asOf: evaluationTime,
    });
    const retirementMonth = calculateTargetRetirementMonth({
      dateOfBirth: data.profileInputs.dateOfBirth,
      targetRetirementAge: data.retirementInputs.targetRetirementAge,
    });

    return decideNotifications({
      month,
      spent,
      budget: budgetTotalForMonth(data.budgets, evaluationTime),
      goals: data.goals,
      events: generateFinancialCalendar({
        from: today,
        through: formatDateOnly(through),
        incomes: data.incomeSources,
        investments: data.investments,
        loans: data.loans,
        budgets: data.budgets,
        plannedExpenses: data.plannedExpenses,
        reminders: data.reminders,
        ...(retirementMonth ? { retirementDate: formatDateOnly(retirementMonth) } : {}),
      }),
      portfolioMilestonePercent: totalInvested > 0
        ? currentPortfolioValue / totalInvested * 100
        : undefined,
      retirementContribution: projection.modeledMonthlyContribution,
      retirementContributionNeeded:
        projection.modeledMonthlyContribution + projection.extraSipRequired,
      taxDueDate: nextTaxDeadline(today),
      ...(anomalousExpense
        ? { anomalousExpense: { id: anomalousExpense.id, amount: anomalousExpense.amount } }
        : {}),
    }, data.notificationPreferences, data.notifications, evaluationTime);
  }, [data, evaluationTime]);

  useEffect(() => {
    if (decidedNotifications.length === 0) return;
    void write((current) => ({
      ...current,
      notifications: [...decidedNotifications, ...current.notifications],
    })).catch(() => {
      toast({
        title: "Alerts could not be refreshed",
        description: "Your preferences are safe. We’ll try again when the planner opens again.",
        variant: "default",
      });
    });
  }, [decidedNotifications, toast, write]);

  const savePreferences = async (values: NotificationPreferences) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: values.timeZone }).format();
      await write((current) => ({ ...current, notificationPreferences: values }));
      form.reset(values);
      toast({ title: "Notification preferences saved" });
    } catch (error) {
      toast({
        title: "Preferences could not be saved",
        description: error instanceof RangeError
          ? "Enter a valid IANA time zone, such as Asia/Kolkata."
          : "Please try again.",
        variant: "default",
      });
    }
  };

  const requestPush = async () => {
    if (!pushPublicKey || pushStatus === "unsupported" || pushStatus === "unconfigured") return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatus(permission);
        form.setValue("push", false, { shouldDirty: true });
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      if (!registration) {
        throw new Error("Install the published app once before enabling push notifications.");
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlBytes(pushPublicKey),
      });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error("The browser returned an incomplete push subscription.");
      }
      await performOperation(() => savePushSubscription({
        endpoint: json.endpoint!,
        p256dh: json.keys!.p256dh!,
        auth: json.keys!.auth!,
        ...(json.expirationTime ? { expirationTime: json.expirationTime } : {}),
      }));
      setPushStatus("subscribed");
      form.setValue("push", true, { shouldDirty: true });
      toast({ title: "Push notifications enabled" });
    } catch (error) {
      form.setValue("push", false, { shouldDirty: true });
      toast({
        title: "Push notifications are not available",
        description: error instanceof Error ? error.message : "Your in-app alerts are unchanged.",
        variant: "default",
      });
    }
  };

  const disablePush = async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await performOperation(() => removePushSubscription(subscription.endpoint));
        await subscription.unsubscribe();
      }
      setPushStatus(Notification.permission);
      form.setValue("push", false, { shouldDirty: true });
    } catch {
      toast({
        title: "Push subscription could not be removed",
        description: "Try again while you are online.",
        variant: "default",
      });
    }
  };

  const handleMarkAllRead = async () => {
    const readAt = new Date().toISOString();
    await write((current) => ({
      ...current,
      notifications: current.notifications.map((notification) => (
        notification.readAt ? notification : { ...notification, readAt }
      )),
    }));
  };

  const handleMarkRead = async (id: string) => {
    await write((current) => ({
      ...current,
      notifications: current.notifications.map((notification) => (
        notification.id === id
          ? { ...notification, readAt: notification.readAt ?? new Date().toISOString() }
          : notification
      )),
    }));
  };

  // This surface is intentionally only the in-app channel. Push delivery is
  // handled by the service worker and must not make an alert appear here when
  // in-app consent was withheld.
  const delivered = data.notifications.filter(
    (notification) => notification.channels.includes("in-app")
      && new Date(notification.deliverAfter).getTime() <= Date.now(),
  );
  const unreadCount = delivered.filter((notification) => !notification.readAt).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle>Recent alerts</CardTitle>
            <CardDescription>
              {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}
            </CardDescription>
          </div>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
              Mark all as read
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {delivered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You’re all caught up. New alerts will appear here.
            </p>
          ) : delivered.slice(0, 20).map((notification) => (
            <div
              key={notification.id}
              className={`flex items-start justify-between rounded-lg border p-3 ${notification.readAt ? "border-transparent" : "border-primary/20 bg-muted/50"}`}
            >
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-semibold">{notification.title}</span>
                  {!notification.readAt && <span className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <p className="text-sm text-muted-foreground">{notification.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(notification.createdAt).toLocaleString()}
                </p>
              </div>
              {!notification.readAt && (
                <Button variant="ghost" size="sm" onClick={() => handleMarkRead(notification.id)}>
                  Mark read
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(savePreferences)} className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle>Global consent</CardTitle>
                <CardDescription>Master switch for every notification rule and channel.</CardDescription>
              </div>
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardHeader>
          </Card>

          <Card className={!form.watch("enabled") ? "pointer-events-none opacity-50" : ""}>
            <CardHeader>
              <CardTitle>Delivery channels</CardTitle>
              <CardDescription>Choose how alerts can reach you.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="inApp"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <FormLabel className="flex items-center gap-2">
                        <Bell className="h-4 w-4" /> In-app notifications
                      </FormLabel>
                      <FormDescription>Keep financial detail inside your signed-in account.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="push"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-4">
                    <div>
                      <FormLabel className="flex items-center gap-2">
                        <Smartphone className="h-4 w-4" /> Web push
                      </FormLabel>
                      <FormDescription>
                        {pushStatus === "unsupported"
                          ? "Not supported by this browser."
                          : pushStatus === "unconfigured"
                            ? "Not configured on this deployment; in-app alerts still work."
                            : pushStatus === "denied"
                              ? "Blocked in browser settings."
                              : pushStatus === "subscribed"
                                ? "This browser is subscribed."
                                : "Receive supported alerts outside the app."}
                      </FormDescription>
                    </div>
                    {pushStatus === "default" || pushStatus === "granted" ? (
                      <Button type="button" variant="outline" size="sm" onClick={requestPush}>
                        Enable
                      </Button>
                    ) : (
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            if (checked) void requestPush();
                            else void disablePush();
                          }}
                          disabled={["unsupported", "unconfigured", "denied"].includes(pushStatus)}
                        />
                      </FormControl>
                    )}
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="weeklyDigest"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <FormLabel className="flex items-center gap-2">
                        <Mail className="h-4 w-4" /> Weekly email digest
                      </FormLabel>
                       <FormDescription>Save the day you prefer for an email digest. Email delivery requires a configured account-mail service.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="monthlyReportEmail"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <FormLabel className="flex items-center gap-2">
                        <Mail className="h-4 w-4" /> Monthly report email
                      </FormLabel>
                      <FormDescription>Send the completed monthly report to your authenticated account email.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              {form.watch("weeklyDigest") && (
                <FormField
                  control={form.control}
                  name="digestDay"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Digest day</FormLabel>
                      <Select
                        value={String(field.value)}
                        onValueChange={(value) => field.onChange(Number(value))}
                      >
                        <FormControl>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {digestDays.map((day, index) => (
                            <SelectItem key={day} value={String(index)}>{day}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notification types</CardTitle>
              <CardDescription>Each rule can be switched off independently.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {notificationTypes.map((type) => (
                <FormField
                  key={type.id}
                  control={form.control}
                  name={`types.${type.id}`}
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-4">
                      <div>
                        <FormLabel>{type.label}</FormLabel>
                        <FormDescription>{type.description}</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quiet hours</CardTitle>
              <CardDescription>New alerts wait until this daily window ends.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="quietHours.start"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start time</FormLabel>
                    <FormControl><Input type="time" {...field} /></FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="quietHours.end"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End time</FormLabel>
                    <FormControl><Input type="time" {...field} /></FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="timeZone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time zone</FormLabel>
                    <FormControl><Input {...field} placeholder="Asia/Kolkata" /></FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Button type="submit" disabled={!form.formState.isDirty}>
            Save preferences
          </Button>
        </form>
      </Form>
    </div>
  );
}