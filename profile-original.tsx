import { useState, useEffect, type FormEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useProfileInputs, useUpdateProfileInputs } from "@/hooks/use-retirement";
import { type ProfileInputs } from "@/lib/storage";
import { formatDateOnly, parseDateOnly } from "@/lib/storage";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@workspace/wealthone-design-system/components/ui/form";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { DatePickerInput } from "@workspace/wealthone-design-system/components/ui/date-picker-input";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/wealthone-design-system/components/ui/avatar";
import { LogOut, ShieldCheck, ArrowRight, Pencil, CheckCircle2, UserRound, Phone, Mail, Briefcase, Moon, Bell, ChevronDown, ChevronRight, KeyRound, Trash2, Loader2, Download, Database, XCircle } from "lucide-react";
import { Switch } from "@workspace/wealthone-design-system/components/ui/switch";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { activateFinancialDataAccount, removePushSubscription } from "@/lib/financial-api";
import { carryPendingFinancialChangeNoticeAcrossLogout } from "@/hooks/use-financial-write";
import { synchronizeAccountQueryCache } from "@/lib/query-policy";
import { useTheme } from "@/components/theme-provider";
import {
  getWebAuthnErrorMessage,
  isWebAuthnAvailable,
  parseCreationOptions,
  registrationCredentialToJSON,
} from "@/lib/webauthn";
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
  getGetAccountDeletionStatusQueryKey,
  useCancelAccountDeletion,
  useGetAccountDeletionStatus,
  useRequestAccountDeletion,
} from "@workspace/api-client-react";

type AuthUserView = {
  email: string | null;
  profileImageUrl: string | null;
  fullName: string | null;
  isAdmin: boolean;
};

const genderOptions = ["Male", "Female", "Non-binary", "Prefer not to say"] as const;

function normalizeGender(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return genderOptions.find((option) => option.toLowerCase() === normalized) || "";
}

const formatDateDisplay = (dateString?: string | null) => {
  if (!dateString) return "Not set";
  try {
    const d = parseDateOnly(dateString);
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  } catch {
    return dateString;
  }
};

function useBeforeUnload(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}

const personalDetailsSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required").max(100),
  dateOfBirth: z.date({
    required_error: "Date of birth is required.",
  }),
  gender: z.string().min(1, "Please select a gender"),
});

const deletionConfirmationSchema = z.object({
  email: z.string().trim().email("Enter the email on this account."),
  confirmation: z.literal("DELETE MY ACCOUNT", {
    errorMap: () => ({ message: "Type DELETE MY ACCOUNT exactly." }),
  }),
});

export function accountDeletionSignedOutPath(baseUrl = import.meta.env.BASE_URL): string {
  const base = (baseUrl || "/").replace(/\/$/, "");
  const loginPath = `${base}/login`;
  return `${loginPath}?accountDeletion=scheduled&returnTo=${encodeURIComponent("/profile")}`;
}

export async function completeAccountDeletionSignOut(
  queryClient: QueryClient,
  replaceLocation: (path: string) => void = (path) => window.location.replace(path),
  baseUrl = import.meta.env.BASE_URL,
): Promise<void> {
  await queryClient.cancelQueries();
  activateFinancialDataAccount(null);
  synchronizeAccountQueryCache(queryClient, null);
  queryClient.clear();
  replaceLocation(accountDeletionSignedOutPath(baseUrl));
}

function PersonalDetailsSection({ profile, onSave, isSubmitting }: { profile: ProfileInputs, onSave: (data: Partial<ProfileInputs>) => Promise<void>, isSubmitting: boolean }) {
  const [isEditing, setIsEditing] = useState(false);

  const form = useForm<z.infer<typeof personalDetailsSchema>>({
    resolver: zodResolver(personalDetailsSchema),
    defaultValues: {
      fullName: profile.fullName || "",
      gender: normalizeGender(profile.gender),
      dateOfBirth: profile.dateOfBirth ? parseDateOnly(profile.dateOfBirth) : undefined,
    }
  });

  useBeforeUnload(form.formState.isDirty);

  // Reset form if profile changes while not editing
  useEffect(() => {
    if (!isEditing) {
      form.reset({
        fullName: profile.fullName || "",
        gender: normalizeGender(profile.gender),
        dateOfBirth: profile.dateOfBirth ? parseDateOnly(profile.dateOfBirth) : undefined,
      });
    }
  }, [profile, isEditing, form]);

  const onSubmit = async (data: z.infer<typeof personalDetailsSchema>) => {
    try {
      await onSave({
        fullName: data.fullName,
        gender: data.gender,
        dateOfBirth: formatDateOnly(data.dateOfBirth)
      });
      setIsEditing(false);
      form.reset(data); // Resets dirty state
    } catch {
      // Error is caught here so it doesn't propagate, toast handled by onSave
    }
  };

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 bg-muted/20 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            <UserRound className="h-5 w-5" />
          </div>
          <CardTitle className="text-base font-semibold">Personal Details</CardTitle>
        </div>
        {!isEditing && (
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} className="h-11 gap-2 bg-background shadow-sm hover:bg-muted" data-testid="button-edit-personal">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </CardHeader>

      {isEditing ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="p-5 sm:p-6 space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel className="text-foreground/80 font-medium">Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Your full name" {...field} className="h-11 bg-background shadow-sm" data-testid="input-personal-fullname" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80 font-medium">Date of Birth</FormLabel>
                    <DatePickerInput
                      id="profile-date-of-birth"
                      value={field.value}
                      onChange={field.onChange}
                      minDate={new Date(new Date().getFullYear() - 100, 0, 1)}
                      maxDate={new Date()}
                      showTodayShortcut={false}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80 font-medium">Gender</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-11 bg-background shadow-sm" data-testid="select-personal-gender">
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {genderOptions.map((option) => (
                          <SelectItem key={option} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-border/40 mt-6">
              <Button type="button" variant="ghost" onClick={() => { form.reset(); setIsEditing(false); }} disabled={isSubmitting} className="min-h-11" data-testid="button-cancel-personal">
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !form.formState.isDirty} className="min-h-11 min-w-[100px]" data-testid="button-save-personal">
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      ) : (
        <CardContent className="p-5 sm:p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
            <div className="space-y-1">
              <dt className="text-sm font-medium text-muted-foreground">Full name</dt>
              <dd className="text-sm text-foreground font-medium" data-testid="text-profile-fullname">{profile.fullName || "Not set"}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm font-medium text-muted-foreground">Date of birth</dt>
              <dd className="text-sm text-foreground font-medium" data-testid="text-profile-dob">{formatDateDisplay(profile.dateOfBirth)}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm font-medium text-muted-foreground">Gender</dt>
              <dd className="text-sm text-foreground font-medium" data-testid="text-profile-gender">{profile.gender || "Not set"}</dd>
            </div>
          </dl>
        </CardContent>
      )}
    </Card>
  );
}

const contactInfoSchema = z.object({
  phone: z.string().optional().or(z.literal("")),
}).superRefine((data, context) => {
  if (data.phone && data.phone.replace(/\D/g, "").length < 7) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enter a valid mobile number",
      path: ["phone"],
    });
  }
});

function ContactInfoSection({ profile, user, onSave, isSubmitting }: { profile: ProfileInputs, user: AuthUserView | null, onSave: (data: Partial<ProfileInputs>) => Promise<void>, isSubmitting: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const accountEmail = user?.email || "";

  const form = useForm<z.infer<typeof contactInfoSchema>>({
    resolver: zodResolver(contactInfoSchema),
    defaultValues: {
      phone: profile.phone || "",
    }
  });

  useBeforeUnload(form.formState.isDirty);

  useEffect(() => {
    if (!isEditing) {
      form.reset({
        phone: profile.phone || "",
      });
    }
  }, [profile, isEditing, form]);

  const onSubmit = async (data: z.infer<typeof contactInfoSchema>) => {
    try {
      await onSave({
        phone: data.phone || null
      });
      setIsEditing(false);
      form.reset(data);
    } catch {
      // Error handled by onSave
    }
  };

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 bg-muted/20 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            <Phone className="h-5 w-5" />
          </div>
          <CardTitle className="text-base font-semibold">Contact Information</CardTitle>
        </div>
        {!isEditing && (
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} className="h-11 gap-2 bg-background shadow-sm hover:bg-muted" data-testid="button-edit-contact">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </CardHeader>

      {isEditing ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="p-5 sm:p-6 space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground/80">Email Address</div>
                <div className="flex h-11 w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground items-center gap-2 cursor-not-allowed shadow-sm">
                  <Mail className="h-4 w-4" />
                  {accountEmail || profile.email || "No email"}
                </div>
                <p className="text-[11px] text-muted-foreground">Your email is managed securely and used for sign-in.</p>
              </div>

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80 font-medium">Mobile Number</FormLabel>
                    <FormControl>
                      <Input type="tel" placeholder="Your phone number" {...field} className="h-11 bg-background shadow-sm" data-testid="input-contact-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-border/40 mt-6">
              <Button type="button" variant="ghost" onClick={() => { form.reset(); setIsEditing(false); }} disabled={isSubmitting} className="min-h-11" data-testid="button-cancel-contact">
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !form.formState.isDirty} className="min-h-11 min-w-[100px]" data-testid="button-save-contact">
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      ) : (
        <CardContent className="p-5 sm:p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
            <div className="space-y-1">
              <dt className="text-sm font-medium text-muted-foreground">Email address</dt>
              <dd className="text-sm text-foreground font-medium flex items-center gap-2" data-testid="text-profile-email">
                {accountEmail || profile.email || "Not set"}
                {accountEmail && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-600">
                    Verified
                  </span>
                )}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm font-medium text-muted-foreground">Mobile number</dt>
              <dd className="text-sm text-foreground font-medium" data-testid="text-profile-phone">{profile.phone || "Not set"}</dd>
            </div>
          </dl>
        </CardContent>
      )}
    </Card>
  );
}

const retirementSettingsSchema = z.object({
  targetRetirementAge: z.coerce.number().min(40, "Must be at least 40").max(75, "Maximum is 75"),
  lifeExpectancy: z.coerce.number().min(70, "Must be at least 70").max(100, "Maximum is 100"),
  riskPreference: z.enum(["Conservative", "Balanced", "Growth"]),
}).superRefine((data, context) => {
  if (data.targetRetirementAge >= data.lifeExpectancy) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Retirement age must be less than life expectancy",
      path: ["targetRetirementAge"],
    });
  }
});

function RetirementSettingsSection({ profile, onSave, isSubmitting }: { profile: ProfileInputs, onSave: (data: Partial<ProfileInputs>) => Promise<void>, isSubmitting: boolean }) {
  const [isEditing, setIsEditing] = useState(false);

  const form = useForm<z.infer<typeof retirementSettingsSchema>>({
    resolver: zodResolver(retirementSettingsSchema),
    defaultValues: {
      targetRetirementAge: profile.targetRetirementAge || 60,
      lifeExpectancy: profile.lifeExpectancy || 85,
      riskPreference: profile.riskPreference || "Balanced",
    }
  });

  useBeforeUnload(form.formState.isDirty);

  useEffect(() => {
    if (!isEditing) {
      form.reset({
        targetRetirementAge: profile.targetRetirementAge || 60,
        lifeExpectancy: profile.lifeExpectancy || 85,
        riskPreference: profile.riskPreference || "Balanced",
      });
    }
  }, [profile, isEditing, form]);

  const onSubmit = async (data: z.infer<typeof retirementSettingsSchema>) => {
    try {
      await onSave({
        targetRetirementAge: data.targetRetirementAge,
        lifeExpectancy: data.lifeExpectancy,
        riskPreference: data.riskPreference
      });
      setIsEditing(false);
      form.reset(data);
    } catch {
      // Error handled by onSave
    }
  };

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 bg-muted/20 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            <Briefcase className="h-5 w-5" />
          </div>
          <CardTitle className="text-base font-semibold">Retirement Settings</CardTitle>
        </div>
        {!isEditing && (
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} className="h-11 gap-2 bg-background shadow-sm hover:bg-muted" data-testid="button-edit-retirement">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </CardHeader>

      {isEditing ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="p-5 sm:p-6 space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="targetRetirementAge"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80 font-medium">Target Retirement Age</FormLabel>
                    <FormControl>
                      <Input type="number" min={40} max={75} {...field} className="h-11 bg-background shadow-sm" data-testid="input-target-retirement-age" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lifeExpectancy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80 font-medium">Life Expectancy</FormLabel>
                    <FormControl>
                      <Input type="number" min={70} max={100} {...field} className="h-11 bg-background shadow-sm" data-testid="input-life-expectancy" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="riskPreference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground/80 font-medium">Risk Preference</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-11 bg-background shadow-sm" data-testid="select-risk-preference">
                          <SelectValue placeholder="Select risk preference" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Conservative">Conservative</SelectItem>
                        <SelectItem value="Balanced">Balanced</SelectItem>
                        <SelectItem value="Growth">Growth</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-border/40 mt-6">
              <Button type="button" variant="ghost" onClick={() => { form.reset(); setIsEditing(false); }} disabled={isSubmitting} className="min-h-11" data-testid="button-cancel-retirement">
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !form.formState.isDirty} className="min-h-11 min-w-[100px]" data-testid="button-save-retirement">
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      ) : (
        <CardContent className="p-5 sm:p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
            <div className="space-y-1">
              <dt className="text-sm font-medium text-muted-foreground">Target retirement age</dt>
              <dd className="text-sm text-foreground font-medium" data-testid="text-profile-target-retirement-age">{profile.targetRetirementAge || "Not set"}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm font-medium text-muted-foreground">Life expectancy</dt>
              <dd className="text-sm text-foreground font-medium" data-testid="text-profile-life-expectancy">{profile.lifeExpectancy || "Not set"}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm font-medium text-muted-foreground">Risk preference</dt>
              <dd className="text-sm text-foreground font-medium" data-testid="text-profile-risk-preference">{profile.riskPreference || "Not set"}</dd>
            </div>
          </dl>
        </CardContent>
      )}
    </Card>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark"
    || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <Card className="overflow-hidden border-border/60 shadow-sm">
      <CardContent className="p-0">
        <div className="flex min-h-16 items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Moon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium text-foreground">Dark mode</span>
          </div>
          <Switch
            checked={isDark}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
            aria-label="Dark mode"
            data-testid="switch-dark-mode"
          />
        </div>
        <Link
          href="/planner?tab=notifications"
          className="flex min-h-16 items-center justify-between gap-4 border-t border-border/60 px-5 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
          data-testid="link-manage-notifications"
        >
          <span className="flex min-w-0 items-center gap-3">
            <Bell className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium text-foreground">Manage notifications</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

type PasskeyView = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  createdAt?: string | null;
  lastUsedAt?: string | null;
};

function formatPasskeyDate(value?: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

class PasskeyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "PasskeyApiError";
  }
}

async function passkeyApi<T>(url: string, init?: RequestInit): Promise<T> {
  const isMutation = Boolean(init?.method && init.method.toUpperCase() !== "GET");
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: isMutation ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  });
  const body = await response.json().catch(() => null) as (T & { error?: string; reason?: string }) | null;
  if (!response.ok) {
    throw new PasskeyApiError(
      body?.error || "The passkey service is unavailable. Please try again.",
      response.status,
      body?.reason,
    );
  }
  if (response.status === 204) return undefined as T;
  if (body === null) throw new Error("The passkey service returned an invalid response.");
  return body;
}

function PasskeySecuritySection() {
  const [expanded, setExpanded] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [newPasskeyName, setNewPasskeyName] = useState("My passkey");
  const [revokeTarget, setRevokeTarget] = useState<PasskeyView | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [requiresEmailVerification, setRequiresEmailVerification] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const supported = isWebAuthnAvailable();
  const secure = window.isSecureContext;

  async function loadPasskeys() {
    setIsLoading(true);
    try {
      const body = await passkeyApi<{ credentials?: PasskeyView[] } | PasskeyView[]>("/api/auth/passkeys");
      setPasskeys(Array.isArray(body) ? body : body.credentials || []);
      setError("");
      setLoadFailed(false);
      setRequiresEmailVerification(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load your passkeys.");
      setLoadFailed(true);
      setRequiresEmailVerification(
        loadError instanceof PasskeyApiError &&
          (loadError.reason === "current_session_email_verification_required" ||
            loadError.message.includes("Verify your email in this session")),
      );
    } finally {
      setIsLoading(false);
    }
  }

  function showPasskeyError(actionError: unknown, fallback: string) {
    setError(actionError instanceof Error ? actionError.message : fallback);
    setRequiresEmailVerification(
      actionError instanceof PasskeyApiError &&
        (actionError.reason === "current_session_email_verification_required" ||
          actionError.message.includes("Verify your email in this session")),
    );
  }

  useEffect(() => {
    void loadPasskeys();
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  async function addPasskey() {
    setError("");
    setStatus("");
    const passkeyName = newPasskeyName.trim();
    if (!passkeyName) {
      setError("Enter a name for your new passkey.");
      return;
    }
    setPendingAction("add");
    try {
      if (!online) throw new Error("Passkey setup needs an internet connection.");
      const body = await passkeyApi<{
        challengeId?: string;
        options?: Parameters<typeof parseCreationOptions>[0];
        publicKey?: Parameters<typeof parseCreationOptions>[0];
      }>("/api/auth/passkeys/registration/options", { method: "POST", body: "{}" });
      const publicKey = body.options || body.publicKey;
      if (!publicKey || !body.challengeId) throw new Error("The passkey service returned invalid setup details.");
      const credential = await navigator.credentials.create({
        publicKey: parseCreationOptions(publicKey),
      });
      if (!(credential instanceof PublicKeyCredential)) throw new Error("No passkey was created.");
      await passkeyApi("/api/auth/passkeys/registration/verify", {
        method: "POST",
        body: JSON.stringify({
          challengeId: body.challengeId,
          name: passkeyName,
          response: registrationCredentialToJSON(credential),
        }),
      });
      setStatus("Passkey added. You can now use it to sign in.");
      await loadPasskeys();
    } catch (addError) {
      if (addError instanceof DOMException) {
        setError(getWebAuthnErrorMessage(addError, "add"));
      } else {
        showPasskeyError(addError, "We couldn't add this passkey. Please try again.");
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function renamePasskey(event: FormEvent, passkey: PasskeyView) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      setError("Enter a name for this passkey.");
      return;
    }
    setPendingAction(passkey.id);
    setError("");
    try {
      await passkeyApi(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: nextName }),
      });
      setEditingId(null);
      setStatus("Passkey renamed.");
      await loadPasskeys();
    } catch (renameError) {
      showPasskeyError(renameError, "We couldn't rename this passkey.");
    } finally {
      setPendingAction(null);
    }
  }

  async function revokePasskey() {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setPendingAction(target.id);
    setError("");
    try {
      await passkeyApi(`/api/auth/passkeys/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
        body: "{}",
      });
      setRevokeTarget(null);
      setStatus("Passkey revoked. It can no longer sign in to your account.");
      await loadPasskeys();
    } catch (revokeError) {
      showPasskeyError(revokeError, "We couldn't revoke this passkey.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      <Card className="overflow-hidden border-border/60 shadow-sm">
        <CardHeader className="border-b border-border/40 bg-muted/20 p-0">
          <button
            type="button"
            className="flex w-full items-center gap-3 px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
            aria-expanded={expanded}
            aria-controls="passkeys-card-content"
            onClick={() => setExpanded((value) => !value)}
            data-testid="button-toggle-passkeys"
          >
            <span className="rounded-lg bg-primary/10 p-2 text-primary"><KeyRound className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <CardTitle className="text-base font-semibold">Passkeys</CardTitle>
              <span className="mt-1 block text-sm font-normal text-muted-foreground">Faster sign-in protected by your device.</span>
            </span>
            <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </CardHeader>
        {expanded && <CardContent id="passkeys-card-content" className="space-y-5 p-5 sm:p-6">
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm leading-relaxed text-muted-foreground">
            <p>Your fingerprint or face stays with your device. ezyRetire receives a cryptographic proof, never your biometric data or private key.</p>
            <p className="mt-2">Passkey setup and sign-in are online-only. Keep email-code sign-in available as a recovery option.</p>
          </div>

          {!secure ? (
            <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              Passkeys require a secure HTTPS connection. Email-code sign-in remains available.
            </p>
          ) : !supported ? (
            <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              This browser or device doesn't support passkeys. You can continue signing in with an email code.
            </p>
          ) : !online ? (
            <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              You're offline. Reconnect to add or manage passkeys.
            </p>
          ) : null}

          {error && (
            <div role="alert" className="space-y-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive" data-testid="status-passkey-error">
              <p>{error}</p>
              <div className="flex flex-wrap gap-2">
                {requiresEmailVerification ? (
                  <Button asChild size="sm" data-testid="link-verify-email-for-passkeys">
                    <Link href="/login?returnTo=%2Fprofile">Verify with email</Link>
                  </Button>
                ) : loadFailed ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => void loadPasskeys()} data-testid="button-retry-passkeys">
                    Retry
                  </Button>
                ) : null}
              </div>
            </div>
          )}
          {status && <p role="status" aria-live="polite" className="rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400" data-testid="status-passkey-success">{status}</p>}

          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold">Your passkeys</h3>
              <p className="mt-1 text-sm text-muted-foreground">Add more than one so another trusted device can sign in.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <label htmlFor="new-passkey-name" className="text-sm font-medium">New passkey name</label>
                <Input id="new-passkey-name" value={newPasskeyName} onChange={(event) => setNewPasskeyName(event.target.value)} maxLength={80} className="h-11" data-testid="input-new-passkey-name" />
              </div>
              <Button type="button" className="min-h-11 shrink-0 gap-2" disabled={!supported || !online || loadFailed || requiresEmailVerification || pendingAction !== null} onClick={addPasskey} data-testid="button-add-passkey">
                {pendingAction === "add" ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {pendingAction === "add" ? "Adding…" : "Add a passkey"}
              </Button>
            </div>
          </div>

          {isLoading ? (
            <p role="status" className="py-4 text-sm text-muted-foreground">Loading passkeys…</p>
          ) : loadFailed && passkeys.length === 0 ? (
            <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground" data-testid="text-passkeys-unavailable">
              Your passkey list is unavailable until the security check above is completed.
            </p>
          ) : passkeys.length === 0 ? (
            <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground" data-testid="text-no-passkeys">No passkeys added yet.</p>
          ) : (
            <ul className="divide-y rounded-xl border" data-testid="list-passkeys">
              {passkeys.map((passkey) => {
                const displayName = passkey.name || passkey.displayName || "Unnamed passkey";
                return (
                  <li key={passkey.id} className="p-4" data-testid={`row-passkey-${passkey.id}`}>
                    {editingId === passkey.id ? (
                      <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => renamePasskey(event, passkey)}>
                        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} aria-label="Passkey name" autoFocus className="h-11" data-testid={`input-passkey-name-${passkey.id}`} />
                        <div className="flex gap-2">
                          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setEditingId(null)} data-testid={`button-cancel-passkey-${passkey.id}`}>Cancel</Button>
                          <Button type="submit" className="min-h-11" disabled={pendingAction === passkey.id} data-testid={`button-save-passkey-${passkey.id}`}>Save</Button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{displayName}</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Added {formatPasskeyDate(passkey.createdAt)} · Last used {formatPasskeyDate(passkey.lastUsedAt)}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" className="min-h-11" onClick={() => { setEditingId(passkey.id); setName(displayName); setError(""); }} data-testid={`button-rename-passkey-${passkey.id}`}>Rename</Button>
                          <Button type="button" variant="outline" className="min-h-11 gap-2 text-destructive hover:text-destructive" onClick={() => setRevokeTarget(passkey)} data-testid={`button-revoke-passkey-${passkey.id}`}><Trash2 className="h-4 w-4" /> Revoke</Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>}
      </Card>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => { if (!open && pendingAction === null) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this passkey?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.name || revokeTarget?.displayName || "This passkey"} will immediately stop working for sign-in. Other passkeys and email-code sign-in will continue to work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pendingAction !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={pendingAction !== null} onClick={(event) => { event.preventDefault(); void revokePasskey(); }} data-testid="button-confirm-revoke-passkey">
              {pendingAction === revokeTarget?.id ? "Revoking…" : "Revoke passkey"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function Profile() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useProfileInputs();
  const updateProfile = useUpdateProfileInputs();
  const { toast } = useToast();
  const { user, isAuthenticated, logout } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const accountName = user?.fullName || user?.email || "Your ezyRetire account";
  const displayName = profile?.fullName || accountName;
  const initial = displayName.charAt(0).toUpperCase();

  const handleSave = async (partialData: Partial<ProfileInputs>) => {
    if (!profile) return Promise.reject(new Error("Profile not loaded"));

    setIsSubmitting(true);

    // Merge existing profile data with incoming partial updates
    const mergedData = {
      ...profile,
      ...partialData
    };

    return new Promise<void>((resolve, reject) => {
      updateProfile.mutate(mergedData, {
        onSuccess: () => {
          setIsSubmitting(false);
          toast({
            title: "Changes saved",
            description: "Your profile has been updated successfully.",
          });
          resolve();
        },
        onError: () => {
          setIsSubmitting(false);
          toast({
            title: "Error",
            description: "Could not save your profile. Please try again.",
            variant: "destructive"
          });
          reject();
        }
      });
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="motion-safe:animate-pulse flex flex-col items-center">
          <div className="h-10 w-10 bg-primary/20 rounded-full mb-4"></div>
          <p className="text-muted-foreground font-medium">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500 pb-12 max-w-4xl mx-auto font-sans">
      <h1 className="text-2xl md:text-3xl font-serif text-primary" data-testid="heading-your-profile">
        Your Profile
      </h1>

      {/* Profile Header */}
      <div
        className="relative flex flex-col items-start gap-6 overflow-hidden rounded-2xl border border-primary/15 bg-card p-6 shadow-xl shadow-primary/10 ring-1 ring-inset ring-primary/10 dark:shadow-primary/15 md:flex-row md:items-center"
        data-testid="card-profile-summary"
      >
        <div
          className="absolute left-0 top-0 h-24 w-full bg-gradient-to-r from-primary via-primary/85 to-primary/70 dark:from-primary/30 dark:via-primary/15 dark:to-card md:h-32"
          data-testid="profile-summary-gradient"
        />

        <div className="relative pt-12 md:pt-14 flex flex-col md:flex-row items-start md:items-center gap-5 w-full">
          <Avatar className="h-20 w-20 md:h-24 md:w-24 border-4 border-card shadow-md">
            {user?.profileImageUrl && <AvatarImage src={user.profileImageUrl} alt={displayName} />}
            <AvatarFallback className="bg-primary text-3xl font-serif text-primary-foreground">{initial}</AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="text-2xl font-serif font-medium text-foreground md:text-primary-foreground dark:md:text-foreground"
                data-testid="text-profile-display-name"
              >
                {displayName}
              </div>
              {user?.isAdmin === true && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-secondary/50 bg-secondary/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-secondary-foreground shadow-sm md:border-primary-foreground/35 md:bg-background/90 md:text-primary dark:md:border-secondary/50 dark:md:bg-secondary/15 dark:md:text-secondary-foreground"
                  data-testid="badge-profile-admin"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Admin
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-muted-foreground text-sm">
              <Mail className="h-4 w-4 shrink-0" />
              <span className="truncate">{user?.email || profile?.email || "No email provided"}</span>
              {user?.email && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-green-600">
                  <CheckCircle2 className="h-3 w-3" /> Verified
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {user?.isAdmin === true && (
        <Card className="border-border/60 shadow-sm overflow-hidden bg-primary/5">
          <CardHeader className="flex flex-row items-center gap-3 border-b border-border/40 px-5 py-4 sm:px-6">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Administrator Access</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
                Review requests, advisors, service settings, and login activity with this account.
              </p>
              <Link
                href="/admin"
                data-testid="link-open-admin-panel"
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Open admin panel <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {profile && (
        <>
          <AppearanceSection />
          {isAuthenticated && <PasskeySecuritySection />}
          <PersonalDetailsSection profile={profile} onSave={handleSave} isSubmitting={isSubmitting} />
          <RetirementSettingsSection profile={profile} onSave={handleSave} isSubmitting={isSubmitting} />
          <ContactInfoSection profile={profile} user={user} onSave={handleSave} isSubmitting={isSubmitting} />
          <AccountDataControls email={user?.email || profile.email} />
        </>
      )}

      {isAuthenticated && (
        <Card className="overflow-hidden border-border bg-card shadow-sm">
          <CardHeader className="flex flex-row items-center gap-3 border-b border-border px-5 py-4 sm:px-6">
            <div className="rounded-lg bg-muted p-2 text-muted-foreground">
              <LogOut className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold text-card-foreground">Security & Access</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-card-foreground">ezyRetire PIN</h3>
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                    Replace your four-digit PIN after verifying a fresh code sent to your account email.
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" className="min-h-11 shrink-0 shadow-sm">
                <Link href="/login?changePin=true&returnTo=%2Fprofile" data-testid="link-change-pin">
                  Change PIN
                </Link>
              </Button>
            </div>
            <div className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                Sign out of your account on this device. You will need a new sign-in code sent to your email to access your workspace again.
              </p>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0 shadow-sm"
                data-testid="button-sign-out"
                onClick={async () => {
                  if (carryPendingFinancialChangeNoticeAcrossLogout(queryClient)) {
                    activateFinancialDataAccount(null);
                  }
                  try {
                    const registration = await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL);
                    const subscription = await registration?.pushManager.getSubscription();
                    if (subscription) {
                      try {
                        await removePushSubscription(subscription.endpoint);
                      } finally {
                        await subscription.unsubscribe();
                      }
                    }
                  } catch {
                    // Logout must still succeed; an unreachable subscription is
                    // removed after the push service returns 404/410.
                  }
                  logout();
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AccountDataControls({ email }: { email: string | null | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const statusQuery = useGetAccountDeletionStatus({
    query: {
      queryKey: getGetAccountDeletionStatusQueryKey(),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "processing" || status === "blocked" ? 10_000 : false;
      },
    },
  });
  const requestDeletion = useRequestAccountDeletion();
  const cancelDeletion = useCancelAccountDeletion();
  const form = useForm<z.infer<typeof deletionConfirmationSchema>>({
    resolver: zodResolver(deletionConfirmationSchema),
    defaultValues: { email: "", confirmation: "" as "DELETE MY ACCOUNT" },
  });
  const status = statusQuery.data;
  const canCancel = status?.status === "cooling_off";

  const submitDeletion = form.handleSubmit((data) => {
    requestDeletion.mutate({ data }, {
      onSuccess: async () => {
        setDialogOpen(false);
        form.reset();
        await completeAccountDeletionSignOut(queryClient);
      },
      onError: (error) => {
        const recentAuthRequired = "status" in error && error.status === 403;
        toast({
          title: recentAuthRequired ? "Sign in again first" : "Deletion was not scheduled",
          description: recentAuthRequired
            ? "For your security, sign out and sign back in, then retry within 15 minutes."
            : "Check both confirmation fields and try again.",
          variant: "destructive",
        });
      },
    });
  });

  return (
    <>
      <Card className="overflow-hidden border-border/60 shadow-sm">
        <CardHeader className="border-b border-border/40 bg-muted/20 p-0">
          <button
            type="button"
            className="flex w-full items-center gap-3 px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
            aria-expanded={expanded}
            aria-controls="account-data-card-content"
            onClick={() => setExpanded((value) => !value)}
            data-testid="button-toggle-account-data"
          >
            <span className="rounded-lg bg-primary/10 p-2 text-primary"><Database className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <CardTitle className="text-base font-semibold">Your data & account</CardTitle>
              <span className="mt-1 block text-sm font-normal text-muted-foreground">Download your information or manage account deletion.</span>
            </span>
            <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </CardHeader>
        {expanded && <CardContent id="account-data-card-content" className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold">Personal data export</h3>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Download a portable ZIP archive of your account information and vault files for
                personal records, portability, support or audit review, or future migration tools.
                It cannot currently be restored into ezyRetire.
              </p>
            </div>
            <Button asChild className="min-h-11 shrink-0 gap-2">
              <a href="/api/account/export" download data-testid="link-export-personal-data">
                <Download className="h-4 w-4" /> Download ZIP export
              </a>
            </Button>
          </div>

          {statusQuery.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground" data-testid="status-account-deletion-loading">
              Checking account status…
            </p>
          ) : status?.status && status.status !== "none" && status.status !== "cancelled" ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4" data-testid="status-account-deletion">
              <h3 className="text-sm font-semibold">
                {status.status === "cooling_off" ? "Deletion scheduled" : status.status === "blocked" ? "Cleanup retrying" : "Deletion processing"}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {status.status === "cooling_off" && status.scheduledFor
                  ? `Your seven-day cooling period ends ${new Date(status.scheduledFor).toLocaleString("en-IN")}.`
                  : status.status === "blocked"
                    ? "Secure object cleanup has not finished. No database data will be erased until cleanup succeeds."
                    : "Deletion has started and can no longer be cancelled."}
              </p>
              {canCancel && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 min-h-11 gap-2"
                  disabled={cancelDeletion.isPending}
                  onClick={() => cancelDeletion.mutate(undefined, {
                    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAccountDeletionStatusQueryKey() }),
                  })}
                  data-testid="button-cancel-account-deletion"
                >
                  <XCircle className="h-4 w-4" />
                  {cancelDeletion.isPending ? "Cancelling…" : "Cancel deletion"}
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4 rounded-xl border border-negative/30 bg-negative-background/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-negative">Delete account</h3>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  This signs out every device immediately. You then have seven days to cancel before
                  your account, plans, transactions, vault files and support history are permanently erased.
                </p>
              </div>
              <Button type="button" variant="destructive" className="min-h-11 shrink-0" onClick={() => setDialogOpen(true)} data-testid="button-open-account-deletion">
                Delete account
              </Button>
            </div>
          )}
        </CardContent>}
      </Card>

      <AlertDialog open={dialogOpen} onOpenChange={(open) => { if (!requestDeletion.isPending) setDialogOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Export anything you need first. Every device will be signed out now. Deletion begins
              after a seven-day cooling period and cannot be undone once processing starts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Form {...form}>
            <form className="space-y-4" onSubmit={submitDeletion}>
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Account email</FormLabel>
                  <FormControl><Input {...field} placeholder={email || "you@example.com"} autoComplete="email" data-testid="input-delete-account-email" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="confirmation" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type DELETE MY ACCOUNT</FormLabel>
                  <FormControl><Input {...field} autoComplete="off" data-testid="input-delete-account-confirmation" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <AlertDialogFooter>
                <AlertDialogCancel type="button" disabled={requestDeletion.isPending}>Keep my account</AlertDialogCancel>
                <Button type="submit" variant="destructive" disabled={requestDeletion.isPending} data-testid="button-confirm-account-deletion">
                  {requestDeletion.isPending ? "Scheduling…" : "Schedule permanent deletion"}
                </Button>
              </AlertDialogFooter>
            </form>
          </Form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
