import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { financialDataQueryOptions } from "@/lib/query-policy";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/wealthone-design-system/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { CalendarDays, BellRing, FileBarChart, Download } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { CalendarView } from "@/components/planner/calendar-view";
import { NotificationsView } from "@/components/planner/notifications-view";
import { ReportsView } from "@/components/planner/reports-view";
import { buildCompleteFinancialPlan } from "@/lib/export-plan";
import { trackEvent } from "@/lib/analytics";

export default function Planner() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const requestedTab = searchParams.get("tab");
  const activeTab = requestedTab === "notifications" || requestedTab === "reports"
    ? requestedTab
    : "calendar";
  
  const { data, isLoading } = useQuery(financialDataQueryOptions());

  if (isLoading || !data) return <div>Loading...</div>;

  const handleExportPlan = () => {
    trackEvent("plan_exported");
    buildCompleteFinancialPlan(data);
  };

  return (
    <div className="space-y-6">
      <div
        className="flex flex-col gap-4 print:hidden sm:flex-row sm:items-center sm:justify-between"
        data-testid="planner-heading"
      >
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Planner</h1>
          <p className="text-muted-foreground">Manage your schedule, alerts, and snapshots</p>
        </div>
        <Button
          variant="outline"
          className="border-primary/40 bg-primary/10 text-primary shadow-sm hover:border-primary/50 hover:bg-primary/20 dark:border-primary/35 dark:bg-primary/15 dark:text-foreground dark:hover:bg-primary/25"
          onClick={handleExportPlan}
          data-testid="button-export-financial-plan"
        >
          <Download className="h-4 w-4 mr-2" />
          Export Financial Plan
        </Button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(tab) => setLocation(`/planner?tab=${tab}`)}
        className="w-full"
        data-testid="planner-tabs"
      >
        <TabsList className="grid w-full grid-cols-3 print:hidden md:w-auto md:inline-grid">
          <TabsTrigger value="calendar" data-testid="tab-planner-calendar">
            <CalendarDays className="h-4 w-4 mr-2 hidden md:inline" />
            Calendar
          </TabsTrigger>
          <TabsTrigger value="notifications" data-testid="tab-planner-notifications">
            <BellRing className="h-4 w-4 mr-2 hidden md:inline" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-planner-reports">
            <FileBarChart className="h-4 w-4 mr-2 hidden md:inline" />
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="mt-6" data-testid="panel-planner-calendar">
          <CalendarView data={data} />
        </TabsContent>

        <TabsContent value="notifications" className="mt-6" data-testid="panel-planner-notifications">
          <NotificationsView data={data} />
        </TabsContent>

        <TabsContent value="reports" className="mt-6 print:mt-0" data-testid="panel-planner-reports">
          <ReportsView data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
