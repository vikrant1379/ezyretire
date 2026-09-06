import { useEffect, useMemo, useRef } from "react";
import { format, parseISO } from "date-fns";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/wealthone-design-system/components/ui/select";
import { Plus, Copy, Trash2, CalendarIcon, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { getRetirementEndDate, type UIBudgetWindow } from "@/lib/budget-helpers";
import { analyzeBudgetTimeline } from "@/lib/budget-timeline";
import { type RetirementInputs } from "@/lib/storage";
import { Alert, AlertDescription, AlertTitle } from "@workspace/wealthone-design-system/components/ui/alert";
import { formatINR } from "@/lib/utils";

function MonthPicker({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value?: string;
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      id={id}
      type="month"
      value={value ? value.substring(0, 7) : ""}
      onChange={(e) => {
        if (!e.target.value) return onChange("");
        onChange(`${e.target.value}-01`);
      }}
      placeholder={placeholder}
      className="w-full"
    />
  );
}

export function BudgetEditor({ 
  windows, 
  onChange, 
  retirementInputs,
  onInteraction,
}: { 
  windows: UIBudgetWindow[]; 
  onChange: (windows: UIBudgetWindow[]) => void;
  retirementInputs?: RetirementInputs;
  onInteraction?: (
    outcome: "period_added" | "period_duplicated" | "period_removed" | "end_mode_selected" | "warning_resolved",
    data: Record<string, string | number | boolean>,
  ) => void;
}) {
  const retirementEndDate = getRetirementEndDate(retirementInputs);

  const handleUpdate = (index: number, updates: Partial<UIBudgetWindow>) => {
    const newWindows = [...windows];
    newWindows[index] = { ...newWindows[index], ...updates };
    onChange(newWindows);
  };

  const handleRemove = (index: number) => {
    const nextWindows = windows.filter((_, i) => i !== index);
    onChange(nextWindows);
    onInteraction?.("period_removed", { period_count: nextWindows.length });
  };

  const handleDuplicate = (index: number) => {
    const newWindows = [...windows];
    newWindows.splice(index + 1, 0, {
      ...windows[index],
      id: crypto.randomUUID(),
    });
    onChange(newWindows);
    onInteraction?.("period_duplicated", { period_count: newWindows.length });
  };

  const analysis = useMemo(() => {
    return analyzeBudgetTimeline(windows, retirementEndDate);
  }, [windows, retirementEndDate]);
  const previousIssueTypes = useRef<Set<(typeof analysis.issues)[number]["type"]> | null>(null);

  useEffect(() => {
    const currentIssueTypes = new Set(analysis.issues.map((issue) => issue.type));
    if (previousIssueTypes.current) {
      for (const issueType of previousIssueTypes.current) {
        if (!currentIssueTypes.has(issueType)) {
          onInteraction?.("warning_resolved", { warning_type: issueType });
        }
      }
    }
    previousIssueTypes.current = currentIssueTypes;
  }, [analysis.issues, onInteraction]);

  return (
    <div className="space-y-6">
      {windows.map((window, index) => (
        <div
          key={window.id}
          role="group"
          aria-labelledby={`budget-period-${window.id}-title`}
          className="p-4 border rounded-xl bg-card space-y-4"
        >
          <div className="flex justify-between items-center">
            <h4
              id={`budget-period-${window.id}-title`}
              className="font-medium text-sm text-muted-foreground uppercase tracking-wider"
            >
              Plan period {index + 1}
            </h4>
            <div className="flex gap-2">
              <Button type="button" size="icon" variant="ghost" onClick={() => handleDuplicate(index)} aria-label={`Duplicate plan period ${index + 1}`}>
                <Copy className="w-4 h-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" onClick={() => handleRemove(index)} aria-label={`Remove plan period ${index + 1}`}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`budget-period-${window.id}-amount`}>Monthly Amount (₹)</Label>
              <Input
                id={`budget-period-${window.id}-amount`}
                type="number"
                min="0"
                step="0.01"
                value={window.monthlyLimit || ""}
                onChange={(e) => handleUpdate(index, { monthlyLimit: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`budget-period-${window.id}-note`}>Note (Optional)</Label>
              <Input
                id={`budget-period-${window.id}-note`}
                value={window.note || ""}
                onChange={(e) => handleUpdate(index, { note: e.target.value })}
                placeholder="e.g. After kids go to college"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor={`budget-period-${window.id}-start`}>Start Month</Label>
              <MonthPicker
                id={`budget-period-${window.id}-start`}
                value={window.startDate}
                onChange={(val) => handleUpdate(index, { startDate: val })}
                placeholder="Currently Active"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor={`budget-period-${window.id}-end-choice`}>End Choice</Label>
              <Select
                value={window.endMode}
                onValueChange={(val: UIBudgetWindow["endMode"]) => {
                  handleUpdate(index, { endMode: val });
                  onInteraction?.("end_mode_selected", { end_mode: val });
                }}
              >
                <SelectTrigger id={`budget-period-${window.id}-end-choice`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lifelong">Lifelong</SelectItem>
                  <SelectItem value="retirement">Retirement</SelectItem>
                  <SelectItem value="custom">Custom Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {window.endMode === "custom" && (
              <div className="space-y-2 md:col-start-2">
                <Label htmlFor={`budget-period-${window.id}-end`}>End Month</Label>
                <MonthPicker
                  id={`budget-period-${window.id}-end`}
                  value={window.endDate}
                  onChange={(val) => handleUpdate(index, { endDate: val })}
                />
              </div>
            )}
            
            {window.endMode === "retirement" && (
              <div className="md:col-span-2 text-sm text-muted-foreground flex items-center gap-2 bg-muted/50 p-3 rounded-lg">
                <CalendarIcon className="w-4 h-4" />
                Ends before retirement ({retirementEndDate ? format(parseISO(retirementEndDate), "MMMM yyyy") : "Not set"})
              </div>
            )}
          </div>
        </div>
      ))}
      
      {analysis.issues.length > 0 && (
        <div className="space-y-3">
          {analysis.issues.map((issue, idx) => (
            <Alert key={idx} variant={issue.type === "invalid-date" ? "destructive" : "default"} className={issue.type === "overlap" ? "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-400" : ""}>
              {issue.type === "gap" && <AlertTriangle className="h-4 w-4 text-amber-500" />}
              {issue.type === "overlap" && <Info className="h-4 w-4" />}
              {issue.type === "invalid-date" && <AlertCircle className="h-4 w-4" />}
              <AlertTitle>
                {issue.type === "gap" && "Coverage Gap"}
                {issue.type === "overlap" && "Overlapping Windows"}
                {issue.type === "invalid-date" && "Invalid Configuration"}
              </AlertTitle>
              <AlertDescription>
                {issue.type === "gap" && (
                  <span>
                    No budget active from {format(issue.startDate, "MMM yyyy")} 
                    {issue.endDate ? ` until ${format(issue.endDate, "MMM yyyy")}` : " onwards"}.
                  </span>
                )}
                {issue.type === "overlap" && (
                  <span>
                    Multiple windows active concurrently from {format(issue.startDate, "MMM yyyy")}
                    {issue.endDate ? ` until ${format(issue.endDate, "MMM yyyy")}` : " onwards"}, 
                    combining to {formatINR(issue.amount)}/mo. Valid, but ensure this is intentional.
                  </span>
                )}
                {issue.type === "invalid-date" && issue.reason}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {analysis.timeline.length > 0 && (
        <div className="space-y-3" aria-live="polite">
          <div>
            <h4 className="text-sm font-semibold">Your budget story</h4>
            <p className="text-xs text-muted-foreground">Overlapping periods are intentionally added together.</p>
          </div>
          <ol className="space-y-2 border-l-2 border-primary/20 pl-4">
            {analysis.timeline.map((event) => (
              <li key={event.date.toISOString()} className="relative rounded-lg bg-muted/40 p-3">
                <span className="absolute -left-[1.31rem] top-4 h-2.5 w-2.5 rounded-full bg-primary" />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">From {format(event.date, "MMM yyyy")}</span>
                  <span className="text-sm font-semibold">{formatINR(event.newTotal)}/mo combined</span>
                </div>
                {event.activeWindows.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.activeWindows.map((window) =>
                      window.note || `${formatINR(window.monthlyLimit)}/mo period`
                    ).join(" + ")}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-amber-700">No planned budget from this month.</p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-full border-dashed"
        onClick={() => {
          const nextWindows = [...windows, {
            id: crypto.randomUUID(),
            monthlyLimit: 0,
            endMode: "lifelong" as const,
          }];
          onChange(nextWindows);
          onInteraction?.("period_added", { period_count: nextWindows.length });
        }}
      >
        <Plus className="w-4 h-4 mr-2" />
        Add another period
      </Button>
    </div>
  );
}
