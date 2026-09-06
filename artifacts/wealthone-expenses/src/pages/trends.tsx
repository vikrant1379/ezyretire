import { useMemo } from "react";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { useExpenses } from "@/hooks/use-expenses";
import { formatINR } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  Legend
} from "recharts";
import { TrendingUp, TrendingDown, Activity, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { QuickAddExpense } from "@/components/quick-add-expense";

export default function Trends() {
  const { data: expenses = [], isLoading } = useExpenses();

  const trendData = useMemo(() => {
    // Generate last 6 months data
    const months = Array.from({ length: 6 }).map((_, i) => {
      const d = subMonths(new Date(), 5 - i);
      return {
        label: format(d, "MMM yyyy"),
        start: startOfMonth(d),
        end: endOfMonth(d),
      };
    });

    const data = months.map(m => {
      const monthExpenses = expenses.filter(e => 
        isWithinInterval(new Date(e.date), { start: m.start, end: m.end }) && !e.reimbursable
      );
      
      const total = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
      
      // Calculate top category for that month
      const byCategory = monthExpenses.reduce((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + e.amount;
        return acc;
      }, {} as Record<string, number>);
      
      const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

      return {
        name: m.label,
        Total: total,
        topCategoryName: topCategory ? topCategory[0] : "None",
        topCategoryAmount: topCategory ? topCategory[1] : 0
      };
    });

    return data;
  }, [expenses]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-primary/20 rounded-full mb-4"></div>
          <p className="text-muted-foreground">Loading your trends...</p>
        </div>
      </div>
    );
  }

  const currentMonth = trendData[trendData.length - 1];
  const previousMonth = trendData[trendData.length - 2];
  
  const pctChange = previousMonth.Total > 0 
    ? ((currentMonth.Total - previousMonth.Total) / previousMonth.Total) * 100 
    : 0;
    
  const averageSpend = trendData.reduce((sum, d) => sum + d.Total, 0) / trendData.filter(d => d.Total > 0).length || 0;
  const hasSpendingHistory = trendData.some((month) => month.Total > 0);

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-8 md:pb-12">
      <div>
        <h1 className="text-2xl md:text-3xl font-serif text-primary">Trends</h1>
        <p className="text-sm md:text-base text-muted-foreground mt-1">
          Analyze your spending habits over time.
        </p>
      </div>

      {!hasSpendingHistory ? (
        <Card className="border-0 shadow-sm bg-white">
          <CardContent className="flex flex-col items-center justify-center p-6 py-12 md:px-6 md:py-16 text-center">
            <div className="mb-4 flex h-14 w-14 md:h-16 md:w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Activity className="h-7 w-7 md:h-8 md:w-8" />
            </div>
            <h2 className="font-serif text-xl md:text-2xl text-foreground">No spending history yet</h2>
            <p className="mt-2 max-w-md text-xs md:text-sm leading-relaxed text-muted-foreground">
              Once you log a month of expenses, this page shows which categories are creeping up,
              how each month compares to the last, and the six-month average that drives your
              retirement number.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <QuickAddExpense />
              <Button asChild variant="outline">
                <Link href="/transactions">
                  Import or view ledger
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
      <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        <Card className="border-0 shadow-sm bg-white">
          <CardContent className="flex h-full min-h-[126px] flex-col justify-between p-4 md:min-h-[176px] md:p-6">
            <div>
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground md:text-xs">
                Month-over-Month
              </p>
              <div className="mt-3 flex items-center gap-1.5 font-sans text-xl font-bold sm:text-2xl md:mt-4 md:gap-2 md:text-3xl">
                {Math.abs(pctChange).toFixed(2)}%
                {pctChange > 0 ? (
                  <TrendingUp className="h-4 w-4 text-destructive md:h-5 md:w-5" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-emerald-600 md:h-5 md:w-5" />
                )}
              </div>
            </div>
            <p className="text-[10px] md:text-sm text-muted-foreground truncate">
              {pctChange > 0 ? "Increase" : "Decrease"} vs last month
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-white">
          <CardContent className="flex h-full min-h-[126px] flex-col justify-between p-4 md:min-h-[176px] md:p-6">
            <div>
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground md:text-xs">
                6-Month Average
              </p>
              <div className="mt-3 flex items-center gap-1.5 font-sans text-xl font-bold sm:text-2xl md:mt-4 md:gap-2 md:text-3xl">
                <span className="financial-number">{formatINR(averageSpend)}</span>
                <Activity className="h-4 w-4 shrink-0 text-muted-foreground md:h-5 md:w-5" />
              </div>
            </div>
            <p className="text-[10px] md:text-sm text-muted-foreground truncate">
              Avg. monthly expenditure
            </p>
          </CardContent>
        </Card>
        
        <Card className="border-0 shadow-sm bg-primary text-primary-foreground col-span-2 md:col-span-1">
          <CardContent className="flex h-full min-h-[126px] flex-col justify-between p-4 md:min-h-[176px] md:p-6">
            <div>
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-primary-foreground/80 md:text-xs">
                Top Category
              </p>
              <p className="mt-3 truncate font-sans text-xl font-bold sm:text-2xl md:mt-4 md:text-3xl">
                {currentMonth.topCategoryName}
              </p>
            </div>
            <p className="text-[10px] md:text-sm text-primary-foreground/90 truncate">
              {formatINR(currentMonth.topCategoryAmount)} spent this month
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-md bg-white">
        <CardHeader className="p-4 md:p-6 md:pb-4">
          <CardTitle className="text-base md:text-lg font-serif">Spending History (Last 6 Months)</CardTitle>
        </CardHeader>
        <CardContent className="px-2 sm:px-6 p-4 pt-0 md:p-6 md:pt-0">
          <div className="h-[300px] sm:h-[400px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  tickFormatter={(value) => `₹${value >= 1000 ? (value/1000).toFixed(0) + 'k' : value}`}
                  width={45}
                />
                <RechartsTooltip 
                  formatter={(value: number) => [formatINR(value), "Spent"]}
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <Bar 
                  dataKey="Total" 
                  fill="hsl(var(--primary))" 
                  radius={[4, 4, 0, 0]}
                  maxBarSize={50}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}
