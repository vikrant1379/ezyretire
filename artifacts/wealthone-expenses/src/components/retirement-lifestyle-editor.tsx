import { useState } from "react";
import { CheckCircle2, Home, Plane, Settings2, Umbrella, Wallet } from "lucide-react";
import type { RetirementLifestyle } from "@/lib/storage";
import { formatINR } from "@/lib/utils";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { cn } from "@workspace/wealthone-design-system/lib/utils";

const PRESETS: Array<{
  value: RetirementLifestyle;
  multiplier?: number;
  description: string;
  icon: React.ElementType;
}> = [
  { value: "Basic", multiplier: 0.75, description: "Essentials first", icon: Home },
  { value: "Comfortable", multiplier: 1, description: "Maintain today’s plan", icon: Umbrella },
  { value: "Premium", multiplier: 1.5, description: "More travel and choice", icon: Plane },
  { value: "Custom", description: "Set your own amount", icon: Settings2 },
];

export function RetirementLifestyleEditor({
  lifestyle,
  customExpense,
  comfortableExpense,
  configured,
  onLifestyleChange,
  onCustomExpenseChange,
}: {
  lifestyle: RetirementLifestyle;
  customExpense: number;
  comfortableExpense: number;
  configured: boolean;
  onLifestyleChange: (value: RetirementLifestyle) => void;
  onCustomExpenseChange: (value: number) => void;
}) {
  const [editing, setEditing] = useState(!configured);
  const selectedPreset = PRESETS.find((preset) => preset.value === lifestyle) ?? PRESETS[1];
  const selectedAmount = lifestyle === "Custom"
    ? customExpense
    : comfortableExpense * (selectedPreset.multiplier ?? 1);

  return (
    <section
      className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-all duration-300 md:p-6"
      aria-labelledby="retirement-lifestyle-title"
      data-testid="retirement-lifestyle"
    >
      <div className={cn(
        "flex flex-col gap-4 md:flex-row md:items-center md:justify-between",
        editing && "mb-5",
      )}>
        <div>
          <h2 id="retirement-lifestyle-title" className="flex items-center gap-2 font-serif text-lg text-foreground">
            <Wallet className="h-5 w-5 text-primary" />
            {configured ? "Your retirement lifestyle" : "Choose your retirement lifestyle"}
          </h2>
          {configured ? (
            <p className="mt-1 text-sm text-muted-foreground">
              <strong className="font-semibold text-foreground">{lifestyle}</strong>
              {" · "}
              <span className="financial-number">{formatINR(selectedAmount)}/month</span> in today&apos;s rupees
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Start with one clear choice. We automatically account for inflation.
            </p>
          )}
        </div>
        {configured && (
          <Button
            type="button"
            variant={editing ? "secondary" : "outline"}
            size="sm"
            onClick={() => setEditing((open) => !open)}
            aria-expanded={editing}
          >
            {editing ? "Done" : "Change lifestyle"}
          </Button>
        )}
      </div>

      {editing && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-4">
            {PRESETS.map((preset) => {
              const amount = preset.value === "Custom"
                ? customExpense
                : comfortableExpense * (preset.multiplier ?? 1);
              const isSelected = lifestyle === preset.value;
              const Icon = preset.icon;

              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => onLifestyleChange(preset.value)}
                  aria-pressed={isSelected}
                  className={cn(
                    "relative flex min-w-0 flex-col items-start rounded-xl border p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:p-4",
                    isSelected
                      ? "border-primary bg-primary/[0.03] ring-1 ring-primary shadow-sm"
                      : "border-border/60 bg-card hover:border-border hover:bg-muted/40 hover:shadow-sm",
                  )}
                  data-testid={`button-lifestyle-${preset.value.toLowerCase()}`}
                >
                  <div className="mb-3 flex w-full items-center justify-between">
                    <div className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                      isSelected ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground",
                    )}>
                      <Icon className="h-4 w-4" />
                    </div>
                    {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />}
                  </div>
                  <span className="text-sm font-bold text-foreground">{preset.value}</span>
                  <span className="mt-0.5 text-tiny text-muted-foreground">{preset.description}</span>
                  <span className="financial-number mt-3 block w-full border-t border-border/40 pt-2 text-xs font-semibold text-primary">
                    {formatINR(amount)}
                    <span className="ml-1 text-tiny font-normal text-muted-foreground">/mo today</span>
                  </span>
                </button>
              );
            })}
          </div>

          {lifestyle === "Custom" && (
            <div className="mt-4 max-w-md rounded-xl border border-primary/20 bg-primary/5 p-3 md:p-4">
              <Label htmlFor="custom-lifestyle-expense" className="text-xs font-medium text-foreground">
                Custom monthly lifestyle in today&apos;s rupees
              </Label>
              <div className="relative mt-2">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-medium text-muted-foreground">₹</span>
                <Input
                  id="custom-lifestyle-expense"
                  type="number"
                  min={0}
                  data-testid="input-custom-lifestyle-expense"
                  className="bg-card pl-8 pr-16"
                  value={customExpense}
                  onChange={(event) => onCustomExpenseChange(Math.max(0, Number(event.target.value) || 0))}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">/ month</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                We will inflate this amount automatically through retirement.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}