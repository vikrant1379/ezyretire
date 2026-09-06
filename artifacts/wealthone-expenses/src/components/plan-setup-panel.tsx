import { Link } from "wouter";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Progress } from "@workspace/wealthone-design-system/components/ui/progress";
import { ArrowRight, CheckCircle2, Circle, Compass, Sparkles } from "lucide-react";
import type { PlanSetup, PlanSetupStep } from "@/lib/plan-setup";

const headline = (setup: PlanSetup) => {
  if (setup.completedEssentialSteps === 0) return "Let's find out when you can actually retire";
  if (!setup.canProjectRetirement) return "One more input and your projection goes live";
  return "Your projection is running on partial data";
};

const subheadline = (setup: PlanSetup, targetAge: number) => {
  if (!setup.canProjectRetirement) {
    return `We have not assumed anything about your money yet. Until you add your income and what life costs you, age ${targetAge} is just our starting point, not your plan.`;
  }
  return "Add the remaining pieces to sharpen the corpus, the gap and the age you can retire at.";
};

function StepRow({ step }: { step: PlanSetupStep }) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3.5 transition-colors",
        step.done ? "border-emerald-200/70 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20" : "border-border bg-card hover:border-primary/30",
      )}
    >
      {step.done ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/40" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={cn("text-sm font-medium", step.done && "text-emerald-900 dark:text-emerald-300")}>
            {step.title}
          </p>
          {step.optional && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Only if you have one
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.unlocks}</p>
      </div>
      {!step.done && (
        <Button asChild size="sm" variant="ghost" className="shrink-0 text-primary hover:text-primary">
          <Link href={step.href}>
            {step.action}
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      )}
    </li>
  );
}

/**
 * Shown wherever a projection would otherwise be invented from defaults. It
 * states plainly what is still missing and what each input unlocks.
 */
export function PlanSetupPanel({ setup, targetAge }: { setup: PlanSetup; targetAge: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/[0.07] via-card to-emerald-500/[0.06] shadow-sm">
      <div className="p-6 md:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Compass className="h-7 w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-sm font-semibold uppercase tracking-widest text-primary/80">
              Build your plan
            </p>
            <h2 className="font-serif text-3xl leading-tight text-foreground md:text-4xl">
              {headline(setup)}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {subheadline(setup, targetAge)}
            </p>

            <div className="mt-5 max-w-md">
              <div className="mb-2 flex items-center justify-between text-xs font-medium">
                <span className="text-muted-foreground">
                  {setup.completedEssentialSteps} of {setup.essentialSteps} essentials done
                </span>
                <span className="text-primary">{setup.completionPercent}%</span>
              </div>
              <Progress value={setup.completionPercent} className="h-2" />
            </div>
          </div>
        </div>

        <ul className="mt-6 grid gap-2.5 md:grid-cols-2">
          {setup.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </ul>

        <div className="mt-5 flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Retiring at <strong className="text-foreground">{targetAge}</strong> is our starting
              assumption. Change it any time on the Retirement page.
            </span>
          </p>
          {setup.nextStep && (
            <Button asChild size="sm" className="shrink-0 shadow-sm">
              <Link href={setup.nextStep.href}>
                {setup.nextStep.action}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Slim nudge for screens that already have a usable projection. */
export function PlanSetupNudge({ setup }: { setup: PlanSetup }) {
  if (!setup.nextStep) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">{setup.nextStep.title}.</strong> {setup.nextStep.unlocks}
      </p>
      <Button asChild size="sm" variant="outline" className="shrink-0 bg-card">
        <Link href={setup.nextStep.href}>
          {setup.nextStep.action}
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
