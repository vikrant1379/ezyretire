import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetAdviceOverview, getGetAdviceOverviewQueryKey, useCreateAdviceRequest, useSubmitAdvicePaymentReference, AdviceRequestInputTopic } from "@workspace/api-client-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@workspace/wealthone-design-system/components/ui/card";
import { Form, FormControl, FormField, FormFieldHeader, FormItem, FormLabel, FormMessage, FormDescription } from "@workspace/wealthone-design-system/components/ui/form";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Textarea } from "@workspace/wealthone-design-system/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { Checkbox } from "@workspace/wealthone-design-system/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { formatINR } from "@/lib/utils";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { MessageSquareHeart, CheckCircle2, AlertTriangle, MessageCircle, ArrowRight, ShieldCheck, Clock, User, QrCode, Mail } from "lucide-react";
import { useProfileInputs } from "@/hooks/use-retirement";

const consultationTopics = [
  AdviceRequestInputTopic.financial,
  AdviceRequestInputTopic.investment,
  AdviceRequestInputTopic.retirement,
  AdviceRequestInputTopic.tax_planning,
  AdviceRequestInputTopic.tax_compliance,
] as const satisfies readonly AdviceRequestInputTopic[];

const CUSTOMER_ADVICE_REQUESTS_PAUSED = true;

const formSchema = z.object({
  userName: z.string().min(2, "Name is required"),
  whatsappNumber: z.string().min(10, "Please enter a valid WhatsApp number"),
  topic: z.enum(consultationTopics),
  note: z.string().max(1000).optional(),
  consent: z.boolean().refine(val => val === true, {
    message: "You must consent to being contacted via WhatsApp",
  }),
});

export default function Advice() {
  if (!CUSTOMER_ADVICE_REQUESTS_PAUSED) {
    return <LegacyAdviceFlow />;
  }

  return (
    <div
      className="mx-auto flex min-h-[55vh] max-w-3xl items-center py-6 md:min-h-[65vh] md:py-12"
      data-testid="page-advice-paused"
    >
      <Card className="w-full overflow-hidden border-primary/15 shadow-sm">
        <div className="h-1.5 bg-primary" aria-hidden="true" />
        <CardHeader className="items-center px-5 pb-3 pt-8 text-center sm:px-8 md:pt-10">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary md:h-16 md:w-16">
            <MessageSquareHeart className="h-7 w-7 md:h-8 md:w-8" aria-hidden="true" />
          </div>
          <CardTitle className="font-serif text-2xl md:text-3xl">
            Advisor section updates are coming soon
          </CardTitle>
          <CardDescription className="max-w-xl pt-2 text-sm leading-6 md:text-base md:leading-7">
            We are improving the way you request professional guidance. Consultation requests and
            payments are temporarily unavailable while this section is updated.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-8 text-center sm:px-8 md:pb-10">
          <p className="mx-auto max-w-xl text-sm leading-6 text-foreground md:text-base">
            If you would like personal assistance, email our team. We will review your message and
            contact you soon.
          </p>
          <Button asChild size="lg" className="mt-6 w-full sm:w-auto" data-testid="link-advice-email">
            <a href="mailto:hello@ezyretire.com">
              <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
              Email hello@ezyretire.com
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function LegacyAdviceFlow() {
  const { user, isAuthenticated, isLoading: authLoading, login } = useAuth();
  const { data: profile } = useProfileInputs();
  const { toast } = useToast();
  const [paymentReference, setPaymentReference] = useState("");
  
  const { data: overview, isLoading: overviewLoading, refetch } = useGetAdviceOverview({
    query: {
      enabled: isAuthenticated,
      queryKey: getGetAdviceOverviewQueryKey(),
    }
  });

  const createRequest = useCreateAdviceRequest();
  const submitPaymentReference = useSubmitAdvicePaymentReference();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      userName: user?.fullName || "",
      whatsappNumber: "",
      topic: AdviceRequestInputTopic.financial,
      note: "",
      consent: false,
    }
  });

  useEffect(() => {
    if (!form.getValues("userName")) {
      form.setValue(
        "userName",
        profile?.fullName ||
          user?.fullName || "",
      );
    }
    if (!form.getValues("whatsappNumber") && profile?.phone) {
      form.setValue("whatsappNumber", profile.phone);
    }
  }, [form, profile?.fullName, profile?.phone, user?.fullName]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createRequest.mutate({ data: { 
      userName: values.userName,
      whatsappNumber: values.whatsappNumber,
      topic: values.topic,
      note: values.note,
      consent: true 
    } }, {
      onSuccess: () => {
        toast({
          title: "Request submitted successfully",
          description: "We’ll send your WhatsApp confirmation if automatic messaging is available.",
        });
        refetch();
      },
      onError: (err) => {
        toast({ title: "Failed to submit request", description: String(err), variant: "destructive" });
      }
    });
  };

  const onSubmitPaymentReference = () => {
    const reference = paymentReference.trim();
    if (reference.length < 4) {
      toast({
        title: "Enter a valid payment reference",
        description: "Use the UPI transaction ID or reference shown by your payment app.",
        variant: "destructive",
      });
      return;
    }
    submitPaymentReference.mutate(
      { data: { paymentReference: reference } },
      {
        onSuccess: () => {
          setPaymentReference("");
          toast({ title: "Payment reference submitted for verification" });
          refetch();
        },
        onError: (err) => {
          toast({
            title: "Could not submit payment reference",
            description: String(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  if (authLoading || (isAuthenticated && overviewLoading)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-primary/20 rounded-full mb-4"></div>
          <p className="text-muted-foreground">Loading your advice space...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto py-8 md:py-12 animate-in fade-in duration-500">
        <div className="text-center mb-6 md:mb-8">
          <div className="h-12 w-12 md:h-16 md:w-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
            <MessageSquareHeart className="h-6 w-6 md:h-8 md:w-8" />
          </div>
          <h1 className="text-2xl md:text-3xl font-serif text-foreground mb-2 md:mb-3">Expert Financial Advice</h1>
          <p className="text-sm md:text-lg text-muted-foreground">Sign in to request one-on-one guidance from a financial advisor or Chartered Accountant (CA).</p>
        </div>
        <Card className="border border-border shadow-sm text-center py-6 md:py-8">
          <CardContent className="space-y-4 md:space-y-6">
            <p className="text-sm md:text-base text-foreground">We need you to log in to personalize your consultation and ensure the privacy of your financial context.</p>
            <Button size="lg" onClick={() => login()} className="w-full sm:w-auto">
              Sign In to Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const request = overview?.request;
  const advisor = overview?.advisor;
  const settings = overview?.settings;

  if (!request) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-8 md:pb-12">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif text-primary">Get Expert Advice</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1 md:mt-2">
            Tell us whether you need financial-advisor or Chartered Accountant (CA) guidance. Your financial data stays on your device—only your consultation context is shared.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <Card className="md:col-span-2 border-0 shadow-sm">
            <CardHeader className="p-4 md:p-6 md:pb-4">
              <CardTitle className="text-lg md:text-xl font-serif">Request a Consultation</CardTitle>
              <CardDescription className="text-xs md:text-sm">
                Fixed fee: {settings?.currency === 'INR' ? formatINR(settings.consultationFee) : `${settings?.currency} ${settings?.consultationFee}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 md:space-y-6">
                  <FormField
                    control={form.control}
                    name="userName"
                    render={({ field }) => (
                      <FormItem>
                        <FormFieldHeader>
                          <FormLabel>Full Name</FormLabel>
                        </FormFieldHeader>
                        <FormControl>
                          <Input placeholder="Enter your full name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="whatsappNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormFieldHeader>
                          <FormLabel>WhatsApp Number</FormLabel>
                        </FormFieldHeader>
                        <FormControl>
                          <Input placeholder="+91 9876543210" {...field} />
                        </FormControl>
                        <FormDescription>We will contact you here to schedule the session.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="topic"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Guidance needed</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-guidance-needed">
                              <SelectValue placeholder="Select the guidance you need" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={AdviceRequestInputTopic.financial}>Financial advisor — Financial planning</SelectItem>
                            <SelectItem value={AdviceRequestInputTopic.investment}>Financial advisor — Portfolio and investments</SelectItem>
                            <SelectItem value={AdviceRequestInputTopic.retirement}>Financial advisor — Retirement strategy</SelectItem>
                            <SelectItem value={AdviceRequestInputTopic.tax_planning}>Chartered Accountant (CA) — Tax planning</SelectItem>
                            <SelectItem value={AdviceRequestInputTopic.tax_compliance}>Chartered Accountant (CA) — Tax filing and compliance</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Choose the closest fit. Our team reviews your request and matches it with an available professional whose expertise suits the topic.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Additional Context (Optional)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Briefly describe what you'd like to discuss..." 
                            className="resize-none min-h-[100px]"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="consent"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>
                            I consent to being contacted via WhatsApp
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <Button type="submit" className="w-full" disabled={createRequest.isPending}>
                    {createRequest.isPending ? "Submitting..." : "Request Consultation"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <div className="space-y-4 md:space-y-6">
            <Card className="border-0 shadow-sm">
              <CardHeader className="p-4 md:p-6 md:pb-3">
                <CardTitle className="text-sm md:text-base font-serif flex items-center gap-2">
                  <Clock className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground" />
                  What to expect
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 md:p-6 md:pt-0 text-xs md:text-sm text-muted-foreground space-y-2 md:space-y-3">
                <div className="flex gap-2">
                  <div className="w-6 shrink-0 font-semibold text-foreground">1.</div>
                  <p>Submit your request and pay the consultation fee manually.</p>
                </div>
                <div className="flex gap-2">
                  <div className="w-6 shrink-0 font-semibold text-foreground">2.</div>
                  <p>We verify your payment, review your topic and match your request with an available financial advisor or CA whose expertise is a suitable fit.</p>
                </div>
                <div className="flex gap-2">
                  <div className="w-6 shrink-0 font-semibold text-foreground">3.</div>
                  <p>The matched professional contacts you on WhatsApp to understand your query and agree on the next step.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  const isPendingPayment = ['pending', 'submitted', 'rejected'].includes(request.paymentStatus);
  const isAssigned = request.status === 'assigned' || request.status === 'completed';

  const cleanPhone = (phone: string) => phone.replace(/\D/g, '');
  const formatWhatsappLink = (phone: string, refId: number) => {
    const text = `Hi, I'm reaching out regarding my ezyRetire consultation request #${refId}.`;
    return `https://wa.me/${cleanPhone(phone)}?text=${encodeURIComponent(text)}`;
  };
  const formatPaymentWhatsappLink = (phone: string, refId: number) => {
    const text = `Hello ezyRetire, I have submitted consultation request #${refId}. Please share the details to complete the ₹${request.feeAmount} consultation payment via UPI.`;
    return `https://wa.me/${cleanPhone(phone)}?text=${encodeURIComponent(text)}`;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-8 md:pb-12">
      <div>
        <h1 className="text-2xl md:text-3xl font-serif text-primary">Your Consultation</h1>
        <p className="text-sm md:text-base text-muted-foreground mt-1 md:mt-2">
          Request #{request.id} • {new Date(request.createdAt).toLocaleDateString()}
        </p>
      </div>

      {isPendingPayment && (
        <Card className="border-amber-200 bg-amber-50/50 shadow-sm">
          <CardHeader className="p-4 md:p-6 md:pb-4">
            <CardTitle className="text-base md:text-lg font-serif text-amber-900 flex items-center gap-2">
              <QrCode className="h-4 w-4 md:h-5 md:w-5" />
              Payment Required
            </CardTitle>
            <CardDescription className="text-xs md:text-sm text-amber-800">
              Please complete your payment of {settings?.currency === 'INR' ? formatINR(request.feeAmount) : `${settings?.currency} ${request.feeAmount}`} to confirm your request.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0 space-y-3 md:space-y-4 text-amber-900">
            <div className="bg-white/80 border border-amber-200 rounded-lg p-3 md:p-4">
              <p className="text-xs md:text-sm font-medium mb-1">Transfer via UPI to:</p>
              <p className="text-lg md:text-xl font-mono tracking-tight">{settings?.upiId || 'Not configured'}</p>
            </div>
            <p className="text-[10px] md:text-sm">
              After you pay, our team will verify the payment and review your request for a suitable professional match. Keep your request number handy.
            </p>
            {request.paymentStatus === "submitted" ? (
              <div className="rounded-lg border border-amber-200 bg-white/80 p-3 text-sm">
                <p className="font-medium">Payment reference submitted</p>
                <p className="mt-1 break-all text-amber-800">{request.paymentReference}</p>
                <p className="mt-1">Our team is reviewing it. Reload this page to see the latest status.</p>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-white/80 p-3">
                {request.paymentStatus === "rejected" ? (
                  <p className="text-sm font-medium text-destructive">
                    The previous reference could not be verified. Check it and submit again.
                  </p>
                ) : null}
                <label htmlFor="payment-reference" className="text-sm font-medium">
                  UPI transaction reference
                </label>
                <Input
                  id="payment-reference"
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  placeholder="Enter transaction ID / UTR"
                  maxLength={160}
                  data-testid="input-payment-reference"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={onSubmitPaymentReference}
                  disabled={submitPaymentReference.isPending}
                  data-testid="button-submit-payment-reference"
                >
                  {submitPaymentReference.isPending ? "Submitting..." : "Submit payment reference"}
                </Button>
              </div>
            )}
            {settings?.businessWhatsapp ? (
              <Button asChild className="w-full bg-[#25D366] text-white hover:bg-[#128C7E]">
                <a
                  href={formatPaymentWhatsappLink(settings.businessWhatsapp, request.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Continue payment on WhatsApp
                </a>
              </Button>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-white/80 p-3 text-sm">
                WhatsApp payment support is being configured. You can use the UPI ID above or check back shortly.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isPendingPayment && !isAssigned && (
        <Card className="border-0 shadow-sm bg-card">
          <CardHeader className="p-4 md:p-6 md:pb-4">
            <CardTitle className="text-base md:text-lg font-serif flex items-center gap-2">
              <Clock className="h-4 w-4 md:h-5 md:w-5 text-primary" />
              Reviewing Request
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
            <p className="text-xs md:text-sm text-muted-foreground">
              Your payment is confirmed. We are reviewing your topic ({request.topic}) and looking for an available financial advisor or CA with suitable expertise. You will be notified here once a professional is matched.
            </p>
          </CardContent>
        </Card>
      )}

      {isAssigned && advisor && (
        <div className="space-y-4 md:space-y-6">
          <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-emerald-900">Professional Matched</p>
              <p className="text-sm text-emerald-800 mt-1">
                Your consultation is ready. You can now reach out to your matched professional directly to schedule your call.
              </p>
            </div>
          </div>

          <Card className="border-0 shadow-sm overflow-hidden">
            <div className="md:flex">
              <div className="bg-muted/30 p-6 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-border w-full md:w-60 shrink-0">
                {advisor.photoUrl ? (
                  <img src={advisor.photoUrl} alt={advisor.name} className="h-24 w-24 rounded-full object-cover border-4 border-white shadow-sm mb-4" />
                ) : (
                  <div className="h-24 w-24 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-serif mb-4">
                    {advisor.name.charAt(0)}
                  </div>
                )}
                <h3 className="font-serif text-lg text-center">{advisor.name}</h3>
                <p className="text-sm text-muted-foreground text-center mt-1">{advisor.credentials}</p>
              </div>
              
              <div className="p-6 flex-1 flex flex-col justify-between">
                <div>
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Specialties</p>
                    <div className="flex flex-wrap gap-2">
                      {advisor.specialties.map(spec => (
                        <span key={spec} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary/10 text-secondary-foreground">
                          {spec}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-6">
                    {advisor.bio}
                  </p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button asChild className="flex-1 bg-[#25D366] hover:bg-[#128C7E] text-white">
                    <a href={formatWhatsappLink(advisor.whatsapp || settings?.businessWhatsapp || "", request.id)} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="mr-2 h-4 w-4" />
                      Message on WhatsApp
                    </a>
                  </Button>
                  <Button variant="outline" asChild className="flex-1">
                    <Link href="/advisor">
                      View Full Profile
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
      
      <div className="pt-6 border-t border-border flex flex-col sm:flex-row gap-4 sm:justify-between items-start sm:items-center text-sm text-muted-foreground">
        <p>Support: {settings?.businessWhatsapp}</p>
        {user?.isAdmin && (
          <Link href="/admin/advice" className="text-primary hover:underline font-medium flex items-center gap-1">
            Admin Portal <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}
