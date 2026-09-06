import { useEffect, useMemo, useState } from "react";
import {
  useGetAdviceAdminDashboard,
  getGetAdviceAdminDashboardQueryKey,
  useUpdateAdviceSettings,
  useCreateAdvisor,
  useUpdateAdvisor,
  useUpdateAdviceRequest,
  type Advisor,
} from "@workspace/api-client-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@workspace/wealthone-design-system/components/ui/card";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { Textarea } from "@workspace/wealthone-design-system/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/wealthone-design-system/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/wealthone-design-system/components/ui/select";
import { Checkbox } from "@workspace/wealthone-design-system/components/ui/checkbox";
import { Badge } from "@workspace/wealthone-design-system/components/ui/badge";
import { Skeleton } from "@workspace/wealthone-design-system/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/wealthone-design-system/components/ui/dialog";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import {
  Plus,
  Pencil,
  User,
  UserPlus,
  Settings,
  ListOrdered,
  Save,
  Inbox,
  Clock,
  CheckCircle2,
  Wallet,
} from "lucide-react";
import { format } from "date-fns";
import { AdminPageHeader } from "./admin-shell";

const guidanceTopics = {
  financial: {
    label: "Financial advisor — Financial planning",
    professional: "advisor",
  },
  investment: {
    label: "Financial advisor — Portfolio and investments",
    professional: "advisor",
  },
  retirement: {
    label: "Financial advisor — Retirement strategy",
    professional: "advisor",
  },
  tax_planning: {
    label: "Chartered Accountant (CA) — Tax planning",
    professional: "ca",
  },
  tax_compliance: {
    label: "Chartered Accountant (CA) — Tax filing and compliance",
    professional: "ca",
  },
} as const;

type GuidanceFilter = "all" | "advisor" | "ca";

function getGuidanceTopic(topic: string) {
  return guidanceTopics[topic as keyof typeof guidanceTopics];
}

const paymentStatusOptions: Record<string, Array<{ value: string; label: string }>> = {
  pending: [
    { value: "pending", label: "Pending" },
    { value: "waived", label: "Waived" },
  ],
  submitted: [
    { value: "submitted", label: "Reference submitted" },
    { value: "paid", label: "Paid" },
    { value: "rejected", label: "Rejected" },
    { value: "waived", label: "Waived" },
  ],
  rejected: [
    { value: "rejected", label: "Rejected" },
    { value: "waived", label: "Waived" },
  ],
  paid: [
    { value: "paid", label: "Paid" },
    { value: "refunded", label: "Refunded" },
  ],
  waived: [{ value: "waived", label: "Waived" }],
  refunded: [{ value: "refunded", label: "Refunded" }],
};

function getPaymentStatusOptions(status: string) {
  return paymentStatusOptions[status] ?? [{ value: status, label: status }];
}

/**
 * The advice operations panel. Contains all consultation-admin functionality
 * (requests, advisors, settings) backed by the generated admin API hooks.
 * Auth guarding and the admin chrome are provided by AdminGuard / AdminShell,
 * so this component assumes an authenticated admin and focuses on the work.
 */
export function AdminAdvicePanel() {
  const { toast } = useToast();
  const [guidanceFilter, setGuidanceFilter] = useState<GuidanceFilter>("all");

  const {
    data: dashboard,
    isLoading: dashboardLoading,
    isError,
    refetch,
  } = useGetAdviceAdminDashboard({
    query: {
      queryKey: getGetAdviceAdminDashboardQueryKey(),
    },
  });

  const updateSettings = useUpdateAdviceSettings();
  const createAdvisor = useCreateAdvisor();
  const updateAdvisor = useUpdateAdvisor();
  const updateRequest = useUpdateAdviceRequest();

  // Settings state
  const [settingsForm, setSettingsForm] = useState({
    consultationFee: 0,
    currency: "INR",
    businessWhatsapp: "",
    upiId: "",
  });

  useEffect(() => {
    if (!dashboard?.settings) return;
    setSettingsForm({
      consultationFee: dashboard.settings.consultationFee,
      currency: dashboard.settings.currency || "INR",
      businessWhatsapp: dashboard.settings.businessWhatsapp,
      upiId: dashboard.settings.upiId,
    });
  }, [dashboard?.settings]);

  // Advisor form state
  const [isAdvisorDialogOpen, setIsAdvisorDialogOpen] = useState(false);
  const [editingAdvisorId, setEditingAdvisorId] = useState<number | null>(null);
  const [advisorForm, setAdvisorForm] = useState({
    name: "",
    credentials: "",
    bio: "",
    specialties: "",
    languages: "",
    availability: "",
    whatsapp: "",
    phone: "",
    bookingUrl: "",
    photoUrl: "",
    active: true,
  });

  const stats = useMemo(() => {
    const requests = dashboard?.requests ?? [];
    const advisors = dashboard?.advisors ?? [];
    return {
      total: requests.length,
      pendingPayment: requests.filter((r) =>
        ["pending", "submitted"].includes(r.paymentStatus),
      ).length,
      open: requests.filter(
        (r) => r.status !== "completed" && r.status !== "cancelled",
      ).length,
      activeAdvisors: advisors.filter((a) => a.active).length,
    };
  }, [dashboard]);

  const filteredRequests = useMemo(() => {
    const requests = dashboard?.requests ?? [];
    if (guidanceFilter === "all") return requests;

    return requests.filter(
      (request) => getGuidanceTopic(request.topic)?.professional === guidanceFilter,
    );
  }, [dashboard?.requests, guidanceFilter]);

  const handleSaveSettings = () => {
    updateSettings.mutate(
      {
        data: {
          consultationFee: settingsForm.consultationFee,
          businessWhatsapp: settingsForm.businessWhatsapp,
          upiId: settingsForm.upiId,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Settings updated successfully" });
          refetch();
        },
        onError: (error) => {
          toast({
            title: "Could not save settings",
            description:
              error instanceof Error ? error.message : "Please check the details and try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const openNewAdvisorDialog = () => {
    setEditingAdvisorId(null);
    setAdvisorForm({
      name: "",
      credentials: "",
      bio: "",
      specialties: "",
      languages: "",
      availability: "",
      whatsapp: "",
      phone: "",
      bookingUrl: "",
      photoUrl: "",
      active: true,
    });
    setIsAdvisorDialogOpen(true);
  };

  const openEditAdvisorDialog = (advisor: Advisor) => {
    setEditingAdvisorId(advisor.id);
    setAdvisorForm({
      name: advisor.name,
      credentials: advisor.credentials,
      bio: advisor.bio,
      specialties: advisor.specialties.join(", "),
      languages: advisor.languages.join(", "),
      availability: advisor.availability,
      whatsapp: advisor.whatsapp,
      phone: advisor.phone || "",
      bookingUrl: advisor.bookingUrl || "",
      photoUrl: advisor.photoUrl || "",
      active: advisor.active,
    });
    setIsAdvisorDialogOpen(true);
  };

  const handleSaveAdvisor = () => {
    const payload = {
      name: advisorForm.name,
      credentials: advisorForm.credentials,
      bio: advisorForm.bio,
      specialties: advisorForm.specialties
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      languages: advisorForm.languages
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      availability: advisorForm.availability,
      whatsapp: advisorForm.whatsapp,
      phone: advisorForm.phone || undefined,
      bookingUrl: advisorForm.bookingUrl || undefined,
      photoUrl: advisorForm.photoUrl || undefined,
      active: advisorForm.active,
    };

    if (editingAdvisorId) {
      updateAdvisor.mutate(
        { id: editingAdvisorId, data: payload },
        {
          onSuccess: () => {
            toast({ title: "Advisor updated" });
            setIsAdvisorDialogOpen(false);
            refetch();
          },
        },
      );
    } else {
      createAdvisor.mutate(
        { data: payload },
        {
          onSuccess: () => {
            toast({ title: "Advisor created" });
            setIsAdvisorDialogOpen(false);
            refetch();
          },
        },
      );
    }
  };

  const handleUpdateRequest = (
    id: number,
    updates: Parameters<typeof updateRequest.mutate>[0]["data"],
  ) => {
    updateRequest.mutate(
      { id, data: updates },
      {
        onSuccess: () => {
          toast({ title: "Request updated" });
          refetch();
        },
      },
    );
  };

  if (dashboardLoading) {
    return (
      <div className="space-y-8">
        <AdminPageHeader
          title="Advice operations"
          description="Manage consultation requests, advisors, and settings."
          icon={ListOrdered}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-8">
        <AdminPageHeader
          title="Advice operations"
          description="Manage consultation requests, advisors, and settings."
          icon={ListOrdered}
        />
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <Inbox className="h-6 w-6" />
            </div>
            <div>
              <p className="font-medium text-foreground">
                Could not load the dashboard
              </p>
              <p className="text-sm text-muted-foreground">
                There was a problem reaching the operations data.
              </p>
            </div>
            <Button onClick={() => refetch()} data-testid="button-retry-dashboard">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statCards = [
    { label: "Total requests", value: stats.total, icon: ListOrdered },
    { label: "Open", value: stats.open, icon: Clock },
    { label: "Awaiting payment", value: stats.pendingPayment, icon: Wallet },
    { label: "Active advisors", value: stats.activeAdvisors, icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Advice operations"
        description="Manage consultation requests, advisors, and settings."
        icon={ListOrdered}
        actions={
          <Button onClick={openNewAdvisorDialog} data-testid="button-add-advisor-header">
            <UserPlus className="mr-2 h-4 w-4" /> Add advisor
          </Button>
        }
      />

      {/* Operational snapshot */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="border-border">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground tabular-nums">
                  {value}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="requests" className="w-full">
        <TabsList className="grid w-full grid-cols-3 md:w-auto md:inline-grid">
          <TabsTrigger value="requests" className="flex gap-2" data-testid="tab-requests">
            <ListOrdered className="hidden h-4 w-4 sm:block" /> Requests
          </TabsTrigger>
          <TabsTrigger value="advisors" className="flex gap-2" data-testid="tab-advisors">
            <User className="hidden h-4 w-4 sm:block" /> Advisors
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex gap-2" data-testid="tab-settings">
            <Settings className="hidden h-4 w-4 sm:block" /> Settings
          </TabsTrigger>
        </TabsList>

        {/* REQUESTS TAB */}
        <TabsContent value="requests" className="mt-6 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label htmlFor="guidance-filter">Guidance type</Label>
              <p className="text-xs text-muted-foreground">
                Route requests by the professional guidance they need.
              </p>
            </div>
            <Select
              value={guidanceFilter}
              onValueChange={(value) => setGuidanceFilter(value as GuidanceFilter)}
            >
              <SelectTrigger
                id="guidance-filter"
                className="w-full sm:w-64"
                data-testid="select-guidance-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All guidance</SelectItem>
                <SelectItem value="advisor">Financial advisor guidance</SelectItem>
                <SelectItem value="ca">Chartered Accountant (CA) guidance</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {dashboard?.requests && dashboard.requests.length > 0 ? (
            filteredRequests.length > 0 ? (
              <div className="space-y-4" data-testid="request-list">
                {filteredRequests.map((req) => (
                  <Card
                    key={req.id}
                    className="overflow-hidden border-border shadow-sm"
                    data-testid={`card-request-${req.id}`}
                  >
                  <div className="flex flex-col md:flex-row">
                    <div className="border-b border-border bg-muted/40 p-5 md:w-1/3 md:border-b-0 md:border-r">
                      <div className="mb-4 flex items-start justify-between">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">
                            {req.userName}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {req.userEmail}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          #{req.id}
                        </Badge>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground">Topic</span>
                          <span
                            className="text-right font-medium"
                            data-testid={`request-guidance-${req.id}`}
                          >
                            {getGuidanceTopic(req.topic)?.label ?? req.topic}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground">WhatsApp</span>
                          <span className="font-medium">{req.whatsappNumber}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground">Created</span>
                          <span>{format(new Date(req.createdAt), "MMM d, yyyy")}</span>
                        </div>
                      </div>
                      {req.note ? (
                        <div className="mt-4 rounded-lg border border-border bg-card p-3 text-xs italic text-muted-foreground">
                          &ldquo;{req.note}&rdquo;
                        </div>
                      ) : null}
                    </div>

                    <div className="flex-1 space-y-6 p-5">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                            Payment status
                          </Label>
                          <Select
                            value={req.paymentStatus}
                            onValueChange={(val) =>
                              handleUpdateRequest(req.id, { paymentStatus: val as never })
                            }
                          >
                            <SelectTrigger
                              data-testid={`select-payment-${req.id}`}
                              className={
                                req.paymentStatus === "paid"
                                  ? "border-primary/30 bg-primary/5 font-medium text-primary"
                                  : req.paymentStatus === "pending"
                                    ? "border-secondary/40 bg-secondary/10 font-medium text-secondary-foreground"
                                    : ""
                              }
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {getPaymentStatusOptions(req.paymentStatus).map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-right text-xs text-muted-foreground">
                            {req.feeAmount} fee
                          </p>
                          {req.paymentReference ? (
                            <p className="break-all rounded-md bg-muted px-2 py-1 text-xs text-foreground">
                              Ref: {req.paymentReference}
                            </p>
                          ) : null}
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                            Request status
                          </Label>
                          <Select
                            value={req.status}
                            onValueChange={(val) =>
                              handleUpdateRequest(req.id, { status: val as never })
                            }
                          >
                            <SelectTrigger
                              data-testid={`select-status-${req.id}`}
                              className={
                                req.status === "completed"
                                  ? "border-primary/30 bg-primary/5 font-medium text-primary"
                                  : ""
                              }
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="submitted">Submitted</SelectItem>
                              <SelectItem value="reviewing">Reviewing</SelectItem>
                              <SelectItem value="assigned">Assigned</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                            Assigned advisor
                          </Label>
                          <Select
                            value={req.advisorId ? String(req.advisorId) : "none"}
                            onValueChange={(val) =>
                              handleUpdateRequest(req.id, {
                                advisorId: val === "none" ? null : Number(val),
                              })
                            }
                          >
                            <SelectTrigger data-testid={`select-advisor-${req.id}`}>
                              <SelectValue placeholder="Assign advisor" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Unassigned</SelectItem>
                              {(dashboard.advisors ?? []).map((adv) => (
                                <SelectItem key={adv.id} value={String(adv.id)}>
                                  {adv.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </div>
                  </Card>
                ))}
              </div>
            ) : (
              <div
                className="rounded-xl border border-dashed border-border bg-card py-12 text-center"
                data-testid="empty-guidance-filter"
              >
                <p className="font-medium text-foreground">
                  No requests match this guidance type
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose another filter to see the rest of the queue.
                </p>
              </div>
            )
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card py-14 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/5 text-primary">
                <Inbox className="h-7 w-7" />
              </div>
              <p className="font-medium text-foreground">No consultation requests yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                New client requests will appear here as they come in.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ADVISORS TAB */}
        <TabsContent value="advisors" className="mt-6 space-y-6">
          <div className="flex justify-end">
            <Button onClick={openNewAdvisorDialog} data-testid="button-add-advisor">
              <UserPlus className="mr-2 h-4 w-4" /> Add advisor
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {dashboard?.advisors && dashboard.advisors.length > 0 ? (
              dashboard.advisors.map((adv) => (
                <Card
                  key={adv.id}
                  className={adv.active ? "" : "opacity-70"}
                  data-testid={`card-advisor-${adv.id}`}
                >
                  <CardContent className="flex gap-4 p-5">
                    {adv.photoUrl ? (
                      <img
                        src={adv.photoUrl}
                        alt={adv.name}
                        className="h-16 w-16 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 font-serif text-xl text-primary">
                        {adv.name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between">
                        <div className="truncate pr-2">
                          <h3 className="truncate font-semibold text-foreground">
                            {adv.name}
                          </h3>
                          <p className="truncate text-xs text-muted-foreground">
                            {adv.credentials}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => openEditAdvisorDialog(adv)}
                          data-testid={`button-edit-advisor-${adv.id}`}
                          aria-label={`Edit ${adv.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                        {adv.bio}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge
                          variant="secondary"
                          className="bg-secondary/15 text-[10px] text-secondary-foreground"
                        >
                          {adv.specialties.length} specialt
                          {adv.specialties.length === 1 ? "y" : "ies"}
                        </Badge>
                        {adv.active ? (
                          <Badge
                            variant="outline"
                            className="border-primary/30 bg-primary/5 text-[10px] text-primary"
                          >
                            Active
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-destructive/40 text-[10px] text-destructive"
                          >
                            Inactive
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="col-span-full rounded-xl border border-dashed border-border bg-card py-14 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/5 text-primary">
                  <User className="h-7 w-7" />
                </div>
                <p className="font-medium text-foreground">No advisors registered yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add your first advisor to start assigning requests.
                </p>
                <Button
                  onClick={openNewAdvisorDialog}
                  className="mt-4"
                  data-testid="button-add-advisor-empty"
                >
                  <Plus className="mr-2 h-4 w-4" /> Add advisor
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* SETTINGS TAB */}
        <TabsContent value="settings" className="mt-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="font-serif">Consultation settings</CardTitle>
              <CardDescription>
                Configure global parameters for the advice service.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="settings-fee">Consultation fee</Label>
                  <Input
                    id="settings-fee"
                    type="number"
                    value={settingsForm.consultationFee}
                    onChange={(e) =>
                      setSettingsForm((p) => ({
                        ...p,
                        consultationFee: Number(e.target.value),
                      }))
                    }
                    data-testid="input-consultation-fee"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="settings-currency">Currency</Label>
                  <Input
                    id="settings-currency"
                    value={settingsForm.currency}
                    disabled
                    data-testid="input-currency"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-whatsapp">Business WhatsApp number (support)</Label>
                <Input
                  id="settings-whatsapp"
                  value={settingsForm.businessWhatsapp}
                  onChange={(e) =>
                    setSettingsForm((p) => ({ ...p, businessWhatsapp: e.target.value }))
                  }
                  placeholder="e.g. +91 9876543210"
                  data-testid="input-business-whatsapp"
                />
                <p className="text-xs text-muted-foreground">
                  Include the country code (for example, +91 9876543210). Leave blank to show
                  customers that WhatsApp support is unavailable.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-upi">UPI ID for payments</Label>
                <Input
                  id="settings-upi"
                  value={settingsForm.upiId}
                  onChange={(e) =>
                    setSettingsForm((p) => ({ ...p, upiId: e.target.value }))
                  }
                  placeholder="e.g. merchant@bank"
                  data-testid="input-upi-id"
                />
              </div>
            </CardContent>
            <CardFooter className="border-t border-border bg-muted/30 pt-6">
              <Button
                onClick={handleSaveSettings}
                disabled={updateSettings.isPending}
                data-testid="button-save-settings"
              >
                {updateSettings.isPending ? (
                  "Saving..."
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" /> Save settings
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ADVISOR DIALOG */}
      <Dialog open={isAdvisorDialogOpen} onOpenChange={setIsAdvisorDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAdvisorId ? "Edit advisor" : "Add advisor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="adv-name">Full name</Label>
                <Input
                  id="adv-name"
                  value={advisorForm.name}
                  onChange={(e) =>
                    setAdvisorForm((p) => ({ ...p, name: e.target.value }))
                  }
                  data-testid="input-advisor-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adv-credentials">Credentials</Label>
                <Input
                  id="adv-credentials"
                  value={advisorForm.credentials}
                  onChange={(e) =>
                    setAdvisorForm((p) => ({ ...p, credentials: e.target.value }))
                  }
                  placeholder="e.g. CFA, CFP"
                  data-testid="input-advisor-credentials"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adv-bio">Bio</Label>
              <Textarea
                id="adv-bio"
                value={advisorForm.bio}
                onChange={(e) => setAdvisorForm((p) => ({ ...p, bio: e.target.value }))}
                className="h-24"
                data-testid="input-advisor-bio"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="adv-specialties">Specialties (comma separated)</Label>
                <Input
                  id="adv-specialties"
                  value={advisorForm.specialties}
                  onChange={(e) =>
                    setAdvisorForm((p) => ({ ...p, specialties: e.target.value }))
                  }
                  placeholder="Tax, Retirement"
                  data-testid="input-advisor-specialties"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adv-languages">Languages (comma separated)</Label>
                <Input
                  id="adv-languages"
                  value={advisorForm.languages}
                  onChange={(e) =>
                    setAdvisorForm((p) => ({ ...p, languages: e.target.value }))
                  }
                  placeholder="English, Hindi"
                  data-testid="input-advisor-languages"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="adv-whatsapp">WhatsApp number</Label>
                <Input
                  id="adv-whatsapp"
                  value={advisorForm.whatsapp}
                  onChange={(e) =>
                    setAdvisorForm((p) => ({ ...p, whatsapp: e.target.value }))
                  }
                  data-testid="input-advisor-whatsapp"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adv-availability">Availability string</Label>
                <Input
                  id="adv-availability"
                  value={advisorForm.availability}
                  onChange={(e) =>
                    setAdvisorForm((p) => ({ ...p, availability: e.target.value }))
                  }
                  placeholder="Mon-Fri, 9AM-5PM"
                  data-testid="input-advisor-availability"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="adv-photo">Photo URL</Label>
                <Input
                  id="adv-photo"
                  value={advisorForm.photoUrl}
                  onChange={(e) =>
                    setAdvisorForm((p) => ({ ...p, photoUrl: e.target.value }))
                  }
                  placeholder="https://..."
                  data-testid="input-advisor-photo"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adv-booking">Booking URL (Calendly, etc)</Label>
                <Input
                  id="adv-booking"
                  value={advisorForm.bookingUrl}
                  onChange={(e) =>
                    setAdvisorForm((p) => ({ ...p, bookingUrl: e.target.value }))
                  }
                  placeholder="https://..."
                  data-testid="input-advisor-booking"
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Checkbox
                id="active"
                checked={advisorForm.active}
                onCheckedChange={(checked) =>
                  setAdvisorForm((p) => ({ ...p, active: checked as boolean }))
                }
                data-testid="checkbox-advisor-active"
              />
              <label
                htmlFor="active"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Profile is active and available for assignment
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              variant="outline"
              onClick={() => setIsAdvisorDialogOpen(false)}
              data-testid="button-cancel-advisor"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveAdvisor}
              disabled={createAdvisor.isPending || updateAdvisor.isPending}
              data-testid="button-save-advisor"
            >
              {createAdvisor.isPending || updateAdvisor.isPending
                ? "Saving..."
                : "Save advisor"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
