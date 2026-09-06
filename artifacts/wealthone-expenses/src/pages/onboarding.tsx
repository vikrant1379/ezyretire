import { useState } from "react";
import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useProfileInputs, useUpdateProfileInputs } from "@/hooks/use-retirement";
import { formatDateOnly, parseDateOnly } from "@/lib/storage";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@workspace/wealthone-design-system/components/ui/form";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { DatePickerInput } from "@workspace/wealthone-design-system/components/ui/date-picker-input";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { ArrowRight, Info } from "lucide-react";
import { BrandMark } from "@/components/brand-logo";

const onboardingSchema = z
  .object({
    fullName: z.string().trim().min(2, "Full name is required").max(100),
    dateOfBirth: z.date({
      required_error: "Date of birth is required.",
    }),
    gender: z.string().min(1, "Please select a gender"),
    phone: z.string().trim().min(1, "Mobile number is required"),
  })
  .superRefine((data, context) => {
    if (data.phone && data.phone.replace(/\D/g, "").length < 7) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid mobile number",
        path: ["phone"],
      });
    }
  });

type OnboardingValues = z.infer<typeof onboardingSchema>;

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { data: profile, isLoading } = useProfileInputs();
  const updateProfile = useUpdateProfileInputs();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      fullName: profile?.fullName || "",
      gender: profile?.gender || "",
      phone: profile?.phone || "",
      dateOfBirth: profile?.dateOfBirth ? parseDateOnly(profile.dateOfBirth) : undefined,
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-12 w-12 bg-primary/20 rounded-full mb-4"></div>
        </div>
      </div>
    );
  }

  const onSubmit = async (data: OnboardingValues) => {
    setIsSubmitting(true);

    if (profile) {
      updateProfile.mutate(
        {
          ...profile,
          ...data,
          dateOfBirth: formatDateOnly(data.dateOfBirth),
          onboardingCompleted: true,
        },
        {
          onSuccess: () => {
            setIsSubmitting(false);
            setLocation("/");
          },
          onError: () => {
            setIsSubmitting(false);
          },
        }
      );
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden font-sans">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
      
      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 relative z-10">
        
        <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="flex flex-col items-center mb-8 text-center">
            <div className="flex items-center justify-center mb-6 transform transition-transform hover:scale-105 duration-300">
              <BrandMark className="h-16 w-16" />
            </div>
            <h1 className="text-3xl font-serif text-foreground font-semibold mb-2">Welcome to ezyRetire</h1>
            <p className="text-muted-foreground">Your personal finance companion.</p>
          </div>

          <Card className="border-0 shadow-2xl shadow-primary/5 bg-card/60 backdrop-blur-xl">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-serif">Let's get to know you</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Karan Mehta" {...field} className="bg-background/50" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="dateOfBirth"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel className="mb-1">Date of Birth</FormLabel>
                          <DatePickerInput
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
                          <FormLabel>Gender</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger className="bg-background/50">
                                <SelectValue placeholder="Select">
                                  {field.value || undefined}
                                </SelectValue>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Male">Male</SelectItem>
                              <SelectItem value="Female">Female</SelectItem>
                              <SelectItem value="Non-binary">Non-binary</SelectItem>
                              <SelectItem value="Prefer not to say">Prefer not to say</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="p-4 rounded-lg bg-muted/30 space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Info className="h-4 w-4 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Contact Details</p>
                    </div>
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Mobile Number</FormLabel>
                          <FormControl>
                            <Input type="tel" placeholder="+91 9876543210" required {...field} className="bg-background/80" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <Button type="submit" className="w-full mt-6 shadow-md hover:shadow-lg transition-all" size="lg" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <div className="h-5 w-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    ) : (
                      <>
                        Enter ezyRetire <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
