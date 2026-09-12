import { useState } from "react";
import { ArrowRight, Check, Compass, X } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";

const tourSteps = [
  { title: "See your financial picture", body: "The dashboard brings income, spending, debt and investments into one view." },
  { title: "Record what changes", body: "Use Add Expense whenever you spend. Your budget and savings figures update with it." },
  { title: "Build your retirement plan", body: "Add investments and assumptions, then open Retirement to understand your projected corpus." },
];

export function DashboardTour({ dismissed, onDismiss }: { dismissed: boolean; onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  if (dismissed) return null;
  const dismiss = () => onDismiss();
  const item = tourSteps[step];
  return (
    <aside className="rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-sm" aria-label="Dashboard tour" data-testid="panel-dashboard-tour">
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-primary p-2 text-primary-foreground"><Compass className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Quick tour · {step + 1} of {tourSteps.length}</p><h2 className="mt-1 font-serif text-lg">{item.title}</h2></div>
            <Button type="button" variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss dashboard tour" data-testid="button-dismiss-dashboard-tour"><X className="h-4 w-4" /></Button>
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground" data-testid="text-dashboard-tour-step">{item.body}</p>
          <div className="mt-3 flex justify-end">
            <Button type="button" size="sm" onClick={() => step === tourSteps.length - 1 ? dismiss() : setStep(step + 1)} data-testid="button-dashboard-tour-next">
              {step === tourSteps.length - 1 ? <><Check className="mr-2 h-4 w-4" />Done</> : <>Next<ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}