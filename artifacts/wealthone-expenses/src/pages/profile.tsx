import { useProfileInputs, useUpdateProfileInputs } from "@/hooks/use-retirement";
import { type ProfileInputs } from "@/lib/storage";
import { formatDateOnly, parseDateOnly } from "@/lib/storage";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/wealthone-design-system/components/ui/avatar";
import { ShieldCheck, ChevronRight, UserRound, Phone, Mail, Briefcase, Settings as SettingsIcon, LogOut, Bell, CircleHelp, Moon, Sun } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Link, useLocation, useSearch } from "wouter";
import { useTheme } from "@/components/theme-provider";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
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
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { activateFinancialDataAccount, removePushSubscription } from "@/lib/financial-api";
import { carryPendingFinancialChangeNoticeAcrossLogout } from "@/hooks/use-financial-write";
import { useEditorGuard } from "@/hooks/use-editor-guard";

export {
  accountDeletionSignedOutPath,
  completeAccountDeletionSignOut,
} from "@/lib/account-deletion-sign-out";

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

const personalDetailsSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required").max(100),
  dateOfBirth: z.date({ required_error: "Date of birth is required." }),
  gender: z.string().min(1, "Please select a gender"),
});

function PersonalDetailsEditor({
  profile,
  onSave,
  isSubmitting,
}: {
  profile: ProfileInputs;
  onSave: (data: Partial<ProfileInputs>) => Promise<void>;
  isSubmitting: boolean;
}) {
  const form = useForm<z.infer<typeof personalDetailsSchema>>({
    resolver: zodResolver(personalDetailsSchema),
    defaultValues: {
      fullName: profile.fullName || "",
      gender: normalizeGender(profile.gender),
      dateOfBirth: profile.dateOfBirth ? parseDateOnly(profile.dateOfBirth) : undefined,
    },
  });

  const { confirmDiscard, markClean, navigateAfterDiscard } = useEditorGuard(form.formState.isDirty);

  const handleCancel = () => {
    if (confirmDiscard()) navigateAfterDiscard("/profile");
  };

  const onSubmit = async (data: z.infer<typeof personalDetailsSchema>) => {
    try {
      await onSave({
        fullName: data.fullName,
        gender: data.gender,
        dateOfBirth: formatDateOnly(data.dateOfBirth),
      });
      markClean();
      form.reset(data);
      navigateAfterDiscard("/profile");
    } catch {
      // Error handled by onSave
    }
  };

  return (
    <div className="space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4 motion-safe:duration-300">
      <div className="flex items-center gap-2 mb-6">
        <Button variant="ghost" size="icon" onClick={handleCancel} className="h-11 w-11 -ml-2 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label="Back">
           <span className="-translate-y-px font-sans text-[24px] font-light leading-none" aria-hidden="true">‹</span>
        </Button>
        <h2 className="text-xl font-semibold">Personal details</h2>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 gap-6">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-medium text-foreground/80">Full Name</FormLabel>
                  <FormControl><Input placeholder="Your full name" {...field} className="h-11 bg-background shadow-sm" data-testid="input-personal-fullname" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dateOfBirth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-medium text-foreground/80">Date of Birth</FormLabel>
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
                  <FormLabel className="font-medium text-foreground/80">Gender</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger className="h-11 bg-background shadow-sm" data-testid="select-personal-gender"><SelectValue placeholder="Select gender" /></SelectTrigger></FormControl>
                    <SelectContent>{genderOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="pt-6 flex gap-3">
              <Button type="button" variant="outline" onClick={handleCancel} className="h-12 w-full sm:w-auto text-base font-medium">Cancel</Button>
             <Button type="submit" disabled={isSubmitting || !form.formState.isDirty} className="h-12 flex-1 text-base font-medium" data-testid="button-save-personal">{isSubmitting ? "Saving..." : "Save changes"}</Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

const contactInfoSchema = z.object({
  phone: z.string().optional().or(z.literal("")),
}).superRefine((data, context) => {
  if (data.phone && data.phone.replace(/\D/g, "").length < 7) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid mobile number", path: ["phone"] });
  }
});

function ContactInfoEditor({
  profile,
  user,
  onSave,
  isSubmitting,
}: {
  profile: ProfileInputs;
  user: AuthUserView | null;
  onSave: (data: Partial<ProfileInputs>) => Promise<void>;
  isSubmitting: boolean;
}) {
  const accountEmail = user?.email || "";
  const form = useForm<z.infer<typeof contactInfoSchema>>({
    resolver: zodResolver(contactInfoSchema),
    defaultValues: { phone: profile.phone || "" },
  });

  const { confirmDiscard, markClean, navigateAfterDiscard } = useEditorGuard(form.formState.isDirty);

  const handleCancel = () => {
    if (confirmDiscard()) navigateAfterDiscard("/profile");
  };

  const onSubmit = async (data: z.infer<typeof contactInfoSchema>) => {
    try {
      await onSave({ phone: data.phone || null });
      markClean();
      form.reset(data);
      navigateAfterDiscard("/profile");
    } catch {
      // Error handled by onSave
    }
  };

  return (
    <div className="space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4 motion-safe:duration-300">
      <div className="flex items-center gap-2 mb-6">
         <Button variant="ghost" size="icon" onClick={handleCancel} className="h-11 w-11 -ml-2 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label="Back">
           <span className="-translate-y-px font-sans text-[24px] font-light leading-none" aria-hidden="true">‹</span>
        </Button>
        <h2 className="text-xl font-semibold">Contact info</h2>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 gap-6">
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground/80">Email Address</div>
              <div className="flex h-11 w-full cursor-not-allowed items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground shadow-sm"><Mail className="h-4 w-4" />{accountEmail || profile.email || "No email"}</div>
              <p className="text-xs text-muted-foreground">Your email is managed securely and used for sign-in.</p>
            </div>
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-medium text-foreground/80">Mobile Number</FormLabel>
                  <FormControl><Input type="tel" placeholder="Your phone number" {...field} className="h-11 bg-background shadow-sm" data-testid="input-contact-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="pt-6 flex gap-3">
              <Button type="button" variant="outline" onClick={handleCancel} className="h-12 w-full sm:w-auto text-base font-medium">Cancel</Button>
             <Button type="submit" disabled={isSubmitting || !form.formState.isDirty} className="h-12 flex-1 text-base font-medium" data-testid="button-save-contact">{isSubmitting ? "Saving..." : "Save changes"}</Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

const retirementSettingsSchema = z.object({
  targetRetirementAge: z.coerce.number().min(40, "Must be at least 40").max(75, "Maximum is 75"),
  lifeExpectancy: z.coerce.number().min(70, "Must be at least 70").max(100, "Maximum is 100"),
  riskPreference: z.enum(["Conservative", "Balanced", "Growth"]),
}).superRefine((data, context) => {
  if (data.targetRetirementAge >= data.lifeExpectancy) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Retirement age must be less than life expectancy", path: ["targetRetirementAge"] });
  }
});

function RetirementSettingsEditor({
  profile,
  onSave,
  isSubmitting,
}: {
  profile: ProfileInputs;
  onSave: (data: Partial<ProfileInputs>) => Promise<void>;
  isSubmitting: boolean;
}) {
  const form = useForm<z.infer<typeof retirementSettingsSchema>>({
    resolver: zodResolver(retirementSettingsSchema),
    defaultValues: {
      targetRetirementAge: profile.targetRetirementAge || 60,
      lifeExpectancy: profile.lifeExpectancy || 85,
      riskPreference: profile.riskPreference || "Balanced",
    },
  });

  const { confirmDiscard, markClean, navigateAfterDiscard } = useEditorGuard(form.formState.isDirty);

  const handleCancel = () => {
    if (confirmDiscard()) navigateAfterDiscard("/profile");
  };

  const onSubmit = async (data: z.infer<typeof retirementSettingsSchema>) => {
    try {
      await onSave({
        targetRetirementAge: data.targetRetirementAge,
        lifeExpectancy: data.lifeExpectancy,
        riskPreference: data.riskPreference,
      });
      markClean();
      form.reset(data);
      navigateAfterDiscard("/profile");
    } catch {
      // Error handled by onSave
    }
  };

  return (
    <div className="space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4 motion-safe:duration-300">
      <div className="flex items-center gap-2 mb-6">
        <Button variant="ghost" size="icon" onClick={handleCancel} className="h-11 w-11 -ml-2 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label="Back">
           <span className="-translate-y-px font-sans text-[24px] font-light leading-none" aria-hidden="true">‹</span>
        </Button>
        <h2 className="text-xl font-semibold">Retirement preferences</h2>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 gap-6">
            <FormField control={form.control} name="targetRetirementAge" render={({ field }) => (
              <FormItem><FormLabel className="font-medium text-foreground/80">Target Retirement Age</FormLabel><FormControl><Input type="number" min={40} max={75} {...field} className="h-11 bg-background shadow-sm" data-testid="input-target-retirement-age" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="lifeExpectancy" render={({ field }) => (
              <FormItem><FormLabel className="font-medium text-foreground/80">Life Expectancy</FormLabel><FormControl><Input type="number" min={70} max={100} {...field} className="h-11 bg-background shadow-sm" data-testid="input-life-expectancy" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="riskPreference" render={({ field }) => (
              <FormItem>
                <FormLabel className="font-medium text-foreground/80">Risk Preference</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger className="h-11 bg-background shadow-sm" data-testid="select-risk-preference"><SelectValue placeholder="Select risk preference" /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="Conservative">Conservative</SelectItem><SelectItem value="Balanced">Balanced</SelectItem><SelectItem value="Growth">Growth</SelectItem></SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          </div>
          <div className="pt-6 flex gap-3">
              <Button type="button" variant="outline" onClick={handleCancel} className="h-12 w-full sm:w-auto text-base font-medium">Cancel</Button>
             <Button type="submit" disabled={isSubmitting || !form.formState.isDirty} className="h-12 flex-1 text-base font-medium" data-testid="button-save-retirement">{isSubmitting ? "Saving..." : "Save changes"}</Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

export default function Profile() {
  const { data: profile, isLoading } = useProfileInputs();
  const updateProfile = useUpdateProfileInputs();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const queryClient = useQueryClient();
  const { resolvedTheme, setTheme } = useTheme();

  const [isSubmitting, setIsSubmitting] = useState(false);

  const searchParams = new URLSearchParams(searchString);
  const activeSection = searchParams.get("section");

  const accountName = user?.fullName || user?.email || "Your ezyRetire account";
  const displayName = profile?.fullName || accountName;
  const initial = displayName.charAt(0).toUpperCase();

  const handleSave = async (partialData: Partial<ProfileInputs>) => {
    if (!profile) return Promise.reject(new Error("Profile not loaded"));
    setIsSubmitting(true);
    return new Promise<void>((resolve, reject) => {
      updateProfile.mutate({ ...profile, ...partialData }, {
        onSuccess: () => {
          setIsSubmitting(false);
          toast({ title: "Changes saved", description: "Your profile has been updated successfully." });
          resolve();
        },
        onError: () => {
          setIsSubmitting(false);
          toast({ title: "Error", description: "Could not save your profile. Please try again.", variant: "destructive" });
          reject(new Error("Profile update failed"));
        },
      });
    });
  };

  const handleLogout = async () => {
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
      // Logout must still succeed
    }
    await logout();
    setLocation("/");
  };

  if (isLoading || !profile) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 pb-12 pt-4" aria-busy="true">
        <div className="flex items-center gap-4 mb-8">
            <div className="h-16 w-16 rounded-full bg-muted/40 motion-safe:animate-pulse" />
            <div className="space-y-2">
                <div className="h-6 w-40 rounded bg-muted/40 motion-safe:animate-pulse" />
                <div className="h-4 w-32 rounded bg-muted/40 motion-safe:animate-pulse" />
            </div>
        </div>
        <div className="space-y-4">
           <div className="h-32 rounded-2xl bg-muted/40 motion-safe:animate-pulse" />
           <div className="h-32 rounded-2xl bg-muted/40 motion-safe:animate-pulse" />
        </div>
      </div>
    );
  }

  if (activeSection === "personal") {
    return <div className="mx-auto max-w-2xl pb-12 pt-4"><PersonalDetailsEditor profile={profile} onSave={handleSave} isSubmitting={isSubmitting} /></div>;
  }
  if (activeSection === "contact") {
    return <div className="mx-auto max-w-2xl pb-12 pt-4"><ContactInfoEditor profile={profile} user={user} onSave={handleSave} isSubmitting={isSubmitting} /></div>;
  }
  if (activeSection === "retirement") {
    return <div className="mx-auto max-w-2xl pb-12 pt-4"><RetirementSettingsEditor profile={profile} onSave={handleSave} isSubmitting={isSubmitting} /></div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12 pt-2 md:pt-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
      <div className="mb-6">
        <h1 className="sr-only md:not-sr-only md:mb-2 font-serif text-2xl text-primary md:text-3xl" data-testid="heading-your-profile">Your Profile</h1>
      </div>

      {/* Identity Summary */}
      <div className="flex items-center gap-4 py-4 px-2" data-testid="profile-summary">
        <Avatar className="h-16 w-16 shrink-0 border border-border shadow-sm">
          {user?.profileImageUrl && <AvatarImage src={user.profileImageUrl} alt={displayName} />}
          <AvatarFallback className="bg-primary font-serif text-2xl text-primary-foreground">{initial}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-xl text-foreground [overflow-wrap:anywhere]" data-testid="text-profile-display-name">{displayName}</div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
            <span className="[overflow-wrap:anywhere]">{user?.email || profile.email || "No email"}</span>
          </div>
        </div>
      </div>

      {/* Account Settings Group */}
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
        <div className="px-4 py-3 bg-muted/30 border-b border-border/50">
           <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Account</h3>
        </div>
        <div className="divide-y divide-border/50">
          <Link href="/profile?section=personal" className="flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserRound className="h-4 w-4" />
              </div>
              <span className="font-medium text-[15px] min-w-0 [overflow-wrap:anywhere]">Personal details</span>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
          </Link>

          <Link href="/profile?section=contact" className="flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Phone className="h-4 w-4" />
              </div>
              <span className="font-medium text-[15px] min-w-0 [overflow-wrap:anywhere]">Contact info</span>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
          </Link>

          <Link href="/profile?section=retirement" className="flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Briefcase className="h-4 w-4" />
              </div>
              <span className="font-medium text-[15px] min-w-0 [overflow-wrap:anywhere]">Retirement preferences</span>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
          </Link>
        </div>
      </div>

      {/* App Settings Group */}
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
        <div className="px-4 py-3 bg-muted/30 border-b border-border/50">
           <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">App Settings</h3>
        </div>
        <div className="divide-y divide-border/50">
          <Link href="/settings" className="flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <SettingsIcon className="h-4 w-4" />
              </div>
              <span className="font-medium text-[15px] min-w-0 [overflow-wrap:anywhere]">Security & privacy</span>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
          </Link>

          <Link href="/planner?tab=notifications" className="flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" data-testid="link-manage-notifications">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bell className="h-4 w-4" />
              </div>
              <span className="font-medium text-[15px] min-w-0 [overflow-wrap:anywhere]">Notifications</span>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
          </Link>

          <button
            type="button"
            className="w-full flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring text-left"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            role="switch"
            aria-checked={resolvedTheme === "dark"}
            aria-label="Dark mode"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                {resolvedTheme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </div>
              <span className="font-medium text-[15px] min-w-0 [overflow-wrap:anywhere]">Dark mode</span>
            </div>
            <div className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 bg-input data-[state=checked]:bg-primary" data-state={resolvedTheme === "dark" ? "checked" : "unchecked"}>
                <span className="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" data-state={resolvedTheme === "dark" ? "checked" : "unchecked"} />
            </div>
          </button>
        </div>
      </div>

      {/* Support & Admin Group */}
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
        <div className="px-4 py-3 bg-muted/30 border-b border-border/50">
           <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">More</h3>
        </div>
        <div className="divide-y divide-border/50">
          <Link href="/about" className="flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CircleHelp className="h-4 w-4" />
              </div>
              <span className="font-medium text-[15px] min-w-0 [overflow-wrap:anywhere]">Help & about</span>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
          </Link>

          {user?.isAdmin === true && (
             <Link href="/admin" data-testid="link-open-admin-panel" className="flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <span className="font-medium text-[15px] min-w-0 [overflow-wrap:anywhere]">Admin panel</span>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
              </Link>
          )}
        </div>
      </div>

      {/* Sign Out (Visually Separate Red Row) */}
      <div className="rounded-2xl border border-negative/30 bg-card overflow-hidden shadow-sm">
        <button
          type="button"
          onClick={handleLogout}
          data-testid="button-sign-out"
          className="w-full flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-negative/5 transition-colors focus-visible:bg-negative/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-negative">
              <LogOut className="h-4 w-4" />
            </div>
            <span className="font-medium text-[15px] text-negative min-w-0 [overflow-wrap:anywhere]">Sign out</span>
          </div>
        </button>
      </div>
    </div>
  );
}