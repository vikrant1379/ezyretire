import { useState } from "react";
import { useGetAdminLoginActivity } from "@workspace/api-client-react";
import { Badge } from "@workspace/wealthone-design-system/components/ui/badge";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent } from "@workspace/wealthone-design-system/components/ui/card";
import { Skeleton } from "@workspace/wealthone-design-system/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Clock3, Laptop, MapPin, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { AdminPageHeader } from "./admin-shell";

const PAGE_SIZE = 25;
const unknown = "Unknown";

function locationLabel(city: string | null, region: string | null, country: string | null) {
  return [city, region, country].filter(Boolean).join(", ") || unknown;
}

export function AdminLoginActivityPanel() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useGetAdminLoginActivity({
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Login activity"
        description="Successful sign-ins from the last 90 days. Location is approximate and IP addresses are not stored."
        icon={ShieldCheck}
      />

      {isLoading ? (
        <div className="space-y-3" aria-label="Loading login activity">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">Login activity could not be loaded.</p>
            <Button variant="outline" onClick={() => refetch()}>Try again</Button>
          </CardContent>
        </Card>
      ) : data?.items.length ? (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="hidden grid-cols-[minmax(12rem,1.4fr)_minmax(10rem,1fr)_minmax(11rem,1fr)_minmax(12rem,1fr)] gap-4 border-b bg-muted/40 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
              <span>User</span><span>Login</span><span>Device</span><span>Approximate location</span>
            </div>
            <div className="divide-y divide-border">
              {data.items.map((item) => (
                <article key={item.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(12rem,1.4fr)_minmax(10rem,1fr)_minmax(11rem,1fr)_minmax(12rem,1fr)] lg:gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.userName || item.userEmail || unknown}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.userEmail || unknown}</p>
                  </div>
                  <div className="text-sm">
                    <p className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-muted-foreground" />{format(new Date(item.loggedInAt), "PP p")}</p>
                    <Badge variant="outline" className="mt-1.5">{item.authMethod === "email_otp" ? "Email code" : "OIDC"}</Badge>
                  </div>
                  <div className="text-sm">
                    <p className="flex items-center gap-1.5"><Laptop className="h-3.5 w-3.5 text-muted-foreground" />{item.deviceType || unknown}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{[item.browser, item.operatingSystem].filter(Boolean).join(" · ") || unknown}</p>
                  </div>
                  <p className="flex items-start gap-1.5 text-sm"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />{locationLabel(item.city, item.region, item.country)}</p>
                </article>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-center justify-between gap-3 text-sm text-muted-foreground sm:flex-row">
            <span>Page {data.page} of {Math.max(data.totalPages, 1)} · {data.total} sign-ins</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
            </div>
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">No login activity yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Successful sign-ins will appear here.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}