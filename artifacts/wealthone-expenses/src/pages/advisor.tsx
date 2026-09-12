import { useLocation, Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetAdviceOverview, getGetAdviceOverviewQueryKey } from "@workspace/api-client-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { ArrowLeft, MessageCircle, Calendar, GraduationCap, Globe, Clock, MessageSquareHeart, User } from "lucide-react";

export default function Advisor() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  
  const { data: overview, isLoading: overviewLoading } = useGetAdviceOverview({
    query: {
      enabled: isAuthenticated,
      queryKey: getGetAdviceOverviewQueryKey(),
    }
  });

  if (authLoading || (isAuthenticated && overviewLoading)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-primary/20 rounded-full mb-4"></div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !overview?.advisor) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center animate-in fade-in duration-500">
        <div className="h-16 w-16 bg-muted text-muted-foreground rounded-full flex items-center justify-center mx-auto mb-4">
          <MessageSquareHeart className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-serif text-foreground mb-3">No Advisor Assigned</h1>
        <p className="text-muted-foreground mb-6">You don't currently have an active consultation with an assigned advisor.</p>
        <Button onClick={() => setLocation("/advice")}>
          Go to Consultations
        </Button>
      </div>
    );
  }

  const advisor = overview.advisor;
  const settings = overview.settings;
  const request = overview.request;
  
  const cleanPhone = (phone: string) => phone.replace(/\D/g, '');
  const formatWhatsappLink = (phone: string) => {
    const text = `Hi ${advisor.name}, I'm reaching out regarding my ezyRetire consultation request #${request?.id || ''}.`;
    return `https://wa.me/${cleanPhone(phone)}?text=${encodeURIComponent(text)}`;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500 pb-12">
      <Button variant="ghost" asChild className="-ml-4 text-muted-foreground hover:text-foreground">
        <Link href="/advice">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Request
        </Link>
      </Button>

      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="h-32 bg-gradient-to-r from-primary/20 to-secondary/20"></div>
        <div className="px-6 md:px-10 pb-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 -mt-16 mb-8">
            <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
              {advisor.photoUrl ? (
                <img src={advisor.photoUrl} alt={advisor.name} className="h-32 w-32 rounded-full object-cover border-4 border-card shadow-sm bg-card" />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-full border-4 border-card bg-background font-serif text-4xl text-foreground shadow-sm">
                  {advisor.name.charAt(0)}
                </div>
              )}
              <div className="text-center md:text-left pb-2">
                <h1 className="text-3xl font-serif text-foreground">{advisor.name}</h1>
                <p className="text-primary font-medium mt-1">{advisor.credentials}</p>
              </div>
            </div>
            <div className="pb-2 flex justify-center w-full md:w-auto">
              <Button asChild className="rounded-full bg-support px-6 text-support-foreground hover:bg-support-hover">
                <a href={formatWhatsappLink(advisor.whatsapp || settings?.businessWhatsapp || "")} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Message
                </a>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-10">
            <div className="space-y-8">
              <section>
                <h2 className="text-lg font-serif mb-3 flex items-center gap-2">
                  <User className="h-5 w-5 text-muted-foreground" />
                  About
                </h2>
                <div className="text-muted-foreground leading-relaxed space-y-4 whitespace-pre-wrap">
                  {advisor.bio}
                </div>
              </section>

              <section>
                <h2 className="text-lg font-serif mb-3 flex items-center gap-2">
                  <GraduationCap className="h-5 w-5 text-muted-foreground" />
                  Expertise
                </h2>
                <div className="flex flex-wrap gap-2">
                  {advisor.specialties.map(spec => (
                    <span key={spec} className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary/5 border border-primary/10 text-foreground">
                      {spec}
                    </span>
                  ))}
                </div>
              </section>
            </div>

            <div className="space-y-6">
              <Card className="border-0 shadow-sm bg-muted/30">
                <CardContent className="p-5 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5" /> Languages
                    </p>
                    <p className="text-sm font-medium">{advisor.languages.join(", ")}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" /> Availability
                    </p>
                    <p className="text-sm font-medium">{advisor.availability}</p>
                  </div>
                  {advisor.bookingUrl && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" /> Booking
                      </p>
                      <Button variant="outline" size="sm" className="w-full" asChild>
                        <a href={advisor.bookingUrl} target="_blank" rel="noopener noreferrer">
                          Schedule Call
                        </a>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
