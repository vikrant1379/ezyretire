import { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useProfileInputs, useUpdateProfileInputs } from "@/hooks/use-retirement";
import { formatDateOnly, parseDateOnly } from "@/lib/storage";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormFieldHeader,
  FormItem,
  FormLabel,
  FormMessage,
} from "@workspace/wealthone-design-system/components/ui/form";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { DatePickerInput } from "@workspace/wealthone-design-system/components/ui/date-picker-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/wealthone-design-system/components/ui/avatar";
import { LogOut, Mail, ShieldCheck } from "lucide-react";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import { activateFinancialDataAccount } from "@/lib/financial-api";
import { carryPendingFinancialChangeNoticeAcrossLogout } from "@/hooks/use-financial-write";

const profileSchema = z
  .object({
    fullName: z.string().trim().min(2, "Full name is required").max(100),
    dateOfBirth: z.date({
      required_error: "Date of birth is required.",
    }),
    gender: z.string().min(1, "Please select a gender"),
    email: z.string().email("Invalid email address").optional().or(z.literal("")),
    phone: z.string().optional().or(z.literal("")),
  })
  .superRefine((data, context) => {
    if (!data.email && !data.phone) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please provide either an email or a phone number.",
        path: ["email"],
      });
    }
    if (data.phone && data.phone.replace(/\D/g, "").length < 7) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid mobile number",
        path: ["phone"],
      });
    }
  });

type ProfileValues = z.infer<typeof profileSchema>;

const genderOptions = ["Male", "Female", "Non-binary", "Prefer not to say"] as const;

function normalizeGender(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return genderOptions.find((option) => option.toLowerCase() === normalized) || "";
}

export default function Profile() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useProfileInputs();
  const updateProfile = useUpdateProfileInputs();
  const { toast } = useToast();
  const { user, isAuthenticated, logout } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const accountName = user?.fullName || user?.email || "Your ezyRetire account";
  const accountEmail = user?.email || "";
  const displayName = profile?.fullName || accountName;

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: "",
      gender: "",
      email: "",
      phone: "",
    },
  });

  useEffect(() => {
    if (profile) {
      form.reset({
        fullName: profile.fullName || accountName,
        gender: normalizeGender(profile.gender),
        email: user ? accountEmail : profile.email || "",
        phone: profile.phone || "",
        dateOfBirth: profile.dateOfBirth ? parseDateOnly(profile.dateOfBirth) : undefined,
      });
    }
  }, [profile, form, user, accountName, accountEmail]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-primary/20 rounded-full mb-4"></div>
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  const onSubmit = async (data: ProfileValues) => {
    if (!profile) return;
    setIsSubmitting(true);
    
    updateProfile.mutate(
      {
        ...profile,
        ...data,
          fullName: data.fullName,
          email: user ? accountEmail : data.email,
        dateOfBirth: formatDateOnly(data.dateOfBirth),
      },
      {
        onSuccess: () => {
          setIsSubmitting(false);
          toast({
            title: "Profile updated",
            description: "Your personal information has been saved successfully.",
          });
        },
        onError: () => {
          setIsSubmitting(false);
          toast({
            title: "Error",
            description: "Could not save your profile. Please try again.",
            variant: "destructive"
          });
        }
      }
    );
  };

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-8 md:pb-12">
      <div>
        <h1 className="text-2xl md:text-3xl font-serif text-primary">Your Profile</h1>
        <p className="text-sm md:text-base text-muted-foreground mt-1">
          Manage your personal information and contact details.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <div className="md:col-span-1 space-y-4 md:space-y-6">
          <Card className="border-0 shadow-md bg-white">
            <CardContent className="p-5 md:pt-6 md:p-6 flex flex-col items-center text-center">
              <Avatar className="h-20 w-20 md:h-24 md:w-24 mb-3 md:mb-4">
                {user?.profileImageUrl && <AvatarImage src={user.profileImageUrl} alt={displayName} />}
                <AvatarFallback className="bg-primary/10 text-primary text-3xl font-serif">{displayName.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <h2 className="text-xl font-semibold break-words max-w-full">{displayName}</h2>
              <p className="text-sm text-muted-foreground flex items-center justify-center mt-1 break-all max-w-full">
                <Mail className="h-3 w-3 mr-1 shrink-0" /> {user?.email || profile?.email || "No email provided"}
              </p>
            </CardContent>
          </Card>

        </div>

        <div className="md:col-span-2">
          <Card className="border-0 shadow-md bg-white">
            <CardHeader className="p-4 md:p-6 md:pb-4">
              <CardTitle className="text-base md:text-lg font-serif">Personal Details</CardTitle>
              <CardDescription className="text-xs md:text-sm">Update your basic information and contact methods.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 md:space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <FormField
                      control={form.control}
                      name="fullName"
                      render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Your full name" {...field} />
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
                          <FormFieldHeader className="md:min-h-6">
                            <FormLabel>Date of Birth</FormLabel>
                          </FormFieldHeader>
                          <DatePickerInput
                            value={field.value}
                            onChange={field.onChange}
                            minDate={new Date(new Date().getFullYear() - 100, 0, 1)}
                            maxDate={new Date()}
                            showTodayShortcut={false}
                             calendarOnly
                          />
                          <p className="text-[10px] text-muted-foreground mt-1">Used to calculate retirement timelines.</p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="gender"
                      render={({ field }) => (
                        <FormItem>
                          <FormFieldHeader className="md:min-h-6">
                            <FormLabel>Gender</FormLabel>
                          </FormFieldHeader>
                          <FormControl>
                            <select
                              {...field}
                              value={field.value || normalizeGender(profile?.gender)}
                              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="" disabled>Select gender</option>
                              {genderOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="pt-5 md:pt-6 mt-5 md:mt-6 border-t border-border">
                    <h3 className="text-sm font-medium mb-3 md:mb-4">Contact Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email Address</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="Email address" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Mobile Number</FormLabel>
                            <FormControl>
                              <Input type="tel" placeholder="Phone number" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-4">
                    <Button 
                      type="submit" 
                      disabled={isSubmitting || !form.formState.isDirty}
                      className="min-w-[120px]"
                    >
                      {isSubmitting ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>

      {isAuthenticated && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            className="w-full md:w-auto"
            onClick={() => {
              if (carryPendingFinancialChangeNoticeAcrossLogout(queryClient)) {
                activateFinancialDataAccount(null);
              }
              logout();
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Log out
          </Button>
        </div>
      )}
    </div>
  );
}
