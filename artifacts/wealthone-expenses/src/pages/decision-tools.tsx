import { useEffect, useMemo, useState } from "react";
import { useLoans } from "@/hooks/use-loans";
import type { Loan } from "@/lib/storage";
import { loanPayoffDetails } from "@/lib/retirement-projection";
import { formatINR } from "@/lib/utils";
import {
  DEFAULT_DECISION_ASSUMPTIONS,
  DECISION_TOOL_ASSUMPTIONS,
  analyzeHealthCover,
  analyzeLifeCover,
  comparePrepayVsInvest,
  compareRentVsBuy,
  staleAssumptionWarnings,
} from "@/lib/decision-tools";
import { Alert, AlertDescription, AlertTitle } from "@workspace/wealthone-design-system/components/ui/alert";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/wealthone-design-system/components/ui/card";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/wealthone-design-system/components/ui/select";
import { Calculator, CircleAlert, HeartPulse, Home, ShieldCheck, TriangleAlert, WalletCards } from "lucide-react";

type NumericRecord = Record<string, number>;
type AssumptionShape = {
  version?: string;
  sourceDate?: string;
  life?: NumericRecord;
  health?: NumericRecord;
  housing?: NumericRecord;
  market?: NumericRecord;
  prepay?: NumericRecord;
};

const assumptions = DEFAULT_DECISION_ASSUMPTIONS as AssumptionShape;
const numberFrom = (record: unknown, keys: string[], fallback = 0) => {
  const values = record && typeof record === "object" ? record as Record<string, unknown> : {};
  for (const key of keys) {
    const value = Number(values[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
};
const numberAt = (record: unknown, path: string[], fallback = 0) => {
  let value: unknown = record;
  for (const key of path) {
    if (!value || typeof value !== "object") return fallback;
    value = (value as Record<string, unknown>)[key];
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const nullableNumberFrom = (record: unknown, keys: string[]) => {
  const values = record && typeof record === "object" ? record as Record<string, unknown> : {};
  for (const key of keys) {
    const candidate = values[key];
    if (candidate == null) continue;
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};
const defaultFrom = (section: NumericRecord | undefined, keys: string[], fallback: number) =>
  numberFrom(section, keys, fallback);

type NumberFieldProps = {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
};

function NumberField({ id, label, value, onChange, suffix, min = 0, max, step = 1, help }: NumberFieldProps) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          data-testid={`input-${id}`}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
          className={`w-full min-w-0 ${suffix ? "pr-14" : ""}`}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

type ResultTone = "positive" | "negative" | "neutral";

const toneForAmount = (value: number): ResultTone =>
  value > 0 ? "positive" : value < 0 ? "negative" : "neutral";

const toneForDeficit = (value: number): ResultTone =>
  value > 0 ? "negative" : value < 0 ? "positive" : "neutral";

function ResultTile({
  label,
  value,
  emphasis = false,
  tone = "neutral",
  testId,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: ResultTone;
  testId: string;
}) {
  return (
    <div className={`rounded-lg border p-3 ${emphasis ? "border-primary/40 bg-primary/5" : "bg-background"}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd data-testid={testId} className={`mt-1 break-words text-base font-semibold tabular-nums md:text-lg ${tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-foreground"}`}>
        {value}
      </dd>
    </div>
  );
}

type LifeInputs = {
  age: number;
  annualIncome: number;
  replacementYears: number;
  existingCover: number;
  liquidAssets: number;
  liabilities: number;
  plannedExpenses: number;
  inflationRate: number;
  investmentReturnRate: number;
  premiumRate: number;
};

function LifeCoverCalculator() {
  const defaults = assumptions.life;
  const initial: LifeInputs = {
    age: 35,
    annualIncome: 1200000,
    replacementYears: defaultFrom(defaults, ["incomeReplacementYears", "replacementYears"], 15),
    existingCover: 2500000,
    liquidAssets: 1000000,
    liabilities: 3500000,
    plannedExpenses: 2500000,
    inflationRate: defaultFrom(defaults, ["inflationRate"], 6),
    investmentReturnRate: defaultFrom(defaults, ["investmentReturnRate", "discountRate"], 7),
    premiumRate: defaultFrom(defaults, ["premiumRatePerThousand", "premiumRate"], 1.5),
  };
  const [values, setValues] = useState(initial);
  const update = (key: keyof LifeInputs) => (value: number) => setValues((current) => ({ ...current, [key]: value }));
  const result = useMemo(() => (analyzeLifeCover as (input: Record<string, number>) => unknown)({
    ...values,
    annualIncomeReplacement: values.annualIncome,
    incomeReplacementYears: values.replacementYears,
    annualIncomeGrowthRate: values.inflationRate,
    annualDiscountRate: values.investmentReturnRate,
    existingLifeCover: values.existingCover,
    earmarkedAssets: values.liquidAssets,
    assets: values.liquidAssets,
    plannedObligations: values.plannedExpenses,
    premiumRatePerThousand: values.premiumRate,
    premiumRatePerThousandLow: values.premiumRate * 0.75,
    premiumRatePerThousandHigh: values.premiumRate * 1.25,
  }), [values]);
  const incomeNeed = numberFrom(result, ["incomeReplacement", "incomeReplacementNeed", "incomeNeed"]);
  const recommended = numberFrom(result, ["recommendedCover", "totalCoverNeed", "coverRequired", "humanLifeValue"]);
  const gap = numberFrom(result, ["coverGap", "gap", "additionalCover"]);
  const premiumLow = numberAt(result, ["estimatedAnnualPremiumRange", "low"]);
  const premiumHigh = numberAt(result, ["estimatedAnnualPremiumRange", "high"]);

  return (
    <Card className="min-w-0 break-inside-avoid print:shadow-none">
      <CardHeader>
        <CardTitle id="life-cover-heading" className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Life cover</CardTitle>
        <CardDescription>Estimate a human-life-value need, then account for existing protection, assets and obligations.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Income and protection</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberField id="life-age" label="Age" value={values.age} onChange={update("age")} min={18} />
            <NumberField id="life-annual-income" label="Annual income to replace" value={values.annualIncome} onChange={update("annualIncome")} step={10000} />
            <NumberField id="life-replacement-years" label="Replacement period" value={values.replacementYears} onChange={update("replacementYears")} suffix="years" />
            <NumberField id="life-existing-cover" label="Existing life cover" value={values.existingCover} onChange={update("existingCover")} step={10000} />
            <NumberField id="life-assets" label="Liquid assets available" value={values.liquidAssets} onChange={update("liquidAssets")} step={10000} />
            <NumberField id="life-liabilities" label="Outstanding liabilities" value={values.liabilities} onChange={update("liabilities")} step={10000} />
            <NumberField id="life-planned-expenses" label="Planned family expenses" value={values.plannedExpenses} onChange={update("plannedExpenses")} step={10000} help="For example, education or dependent care." />
          </div>
        </fieldset>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Calculation assumptions</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <NumberField id="life-inflation" label="Inflation" value={values.inflationRate} onChange={update("inflationRate")} suffix="%" step={0.1} />
            <NumberField id="life-return" label="Investment return" value={values.investmentReturnRate} onChange={update("investmentReturnRate")} suffix="%" step={0.1} />
            <NumberField id="life-premium-rate" label="Premium per ₹1,000 cover" value={values.premiumRate} onChange={update("premiumRate")} step={0.1} />
          </div>
        </details>
        <div aria-live="polite" aria-atomic="true">
          <p className="sr-only">Estimated life cover gap is {formatINR(gap)}.</p>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ResultTile label="Income replacement" value={formatINR(incomeNeed)} testId="value-life-income-need" />
            <ResultTile label="Liabilities + plans" value={formatINR(values.liabilities + values.plannedExpenses)} testId="value-life-obligations" />
            <ResultTile label="Recommended cover" value={formatINR(recommended)} testId="value-life-recommended" />
            <ResultTile label="Cover gap" value={formatINR(gap)} tone={toneForDeficit(gap)} emphasis testId="value-life-gap" />
          </dl>
        </div>
        <div className="rounded-lg bg-muted/60 p-3 text-sm">
          <p className="font-medium">Unconfirmed estimated annual premium range</p>
          <p className="mt-1 tabular-nums text-muted-foreground">{formatINR(premiumLow)} – {formatINR(premiumHigh)} a year</p>
          <p className="mt-1 text-xs text-muted-foreground">This is not a quote and must not be added to expenses until a premium is confirmed.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setValues(initial)} data-testid="button-reset-life">Reset life assumptions</Button>
      </CardContent>
    </Card>
  );
}

type HealthInputs = {
  city: string;
  eldestAge: number;
  adults: number;
  children: number;
  employerCover: number;
  floaterCover: number;
  topUpCover: number;
  benchmarks: Record<"metro" | "tier-2" | "other", number>;
  ageLoadingRate: number;
  premiumRate: number;
};

function HealthCoverCalculator() {
  const defaults = assumptions.health;
  const [values, setValues] = useState<HealthInputs>({
    city: "metro",
    eldestAge: 35,
    adults: 2,
    children: 1,
    employerCover: 500000,
    floaterCover: 500000,
    topUpCover: 0,
    benchmarks: {
      metro: defaultFrom(defaults, ["metroBenchmark"], 1500000),
      "tier-2": defaultFrom(defaults, ["tier2Benchmark"], 1000000),
      other: defaultFrom(defaults, ["otherBenchmark"], 750000),
    },
    ageLoadingRate: defaultFrom(defaults, ["ageLoadingRate"], 3),
    premiumRate: defaultFrom(defaults, ["premiumRate"], 1.2),
  });
  const update = (key: keyof HealthInputs) => (value: number) => setValues((current) => ({ ...current, [key]: value }));
  const result = useMemo(() => (analyzeHealthCover as (input: Record<string, unknown>) => unknown)({
    ...values,
    cityTier: values.city === "metro" ? "tier-1" : values.city === "tier-2" ? "tier-2" : "tier-3",
    age: values.eldestAge,
    familyAdults: values.adults,
    familyChildren: values.children,
    medicalBenchmark: values.benchmarks[values.city as keyof HealthInputs["benchmarks"]],
    existingEmployerCover: values.employerCover,
    existingFloaterCover: values.floaterCover,
    existingTopUpCover: values.topUpCover,
    benchmarkByCity: {
      "tier-1": values.benchmarks.metro,
      "tier-2": values.benchmarks["tier-2"],
      "tier-3": values.benchmarks.other,
    },
    estimatedPremiumRateLow: values.premiumRate / 100 * 0.75,
    estimatedPremiumRateHigh: values.premiumRate / 100 * 1.25,
  }), [values]);
  const recommended = numberFrom(result, ["recommendedCover", "recommendedHealthCover", "coverNeed", "recommendedTotal"]);
  const current = numberFrom(result, ["existingCover", "totalExistingCover", "effectiveCover"], values.employerCover + values.floaterCover + values.topUpCover);
  const gap = numberFrom(result, ["coverGap", "gap", "additionalCover"], numberFrom(result, ["baseGap"]) + numberFrom(result, ["topUpGap"]));
  const base = numberFrom(result, ["baseCoverRecommendation", "baseRecommendation", "benchmark", "recommendedBase"], values.benchmarks[values.city as keyof HealthInputs["benchmarks"]]);
  const premiumLow = numberAt(result, ["estimatedAnnualPremiumRange", "low"]);
  const premiumHigh = numberAt(result, ["estimatedAnnualPremiumRange", "high"]);
  const recommendedBase = numberFrom(result, ["recommendedBase"], base);
  const recommendedTopUp = numberFrom(result, ["recommendedTopUp"], Math.max(0, recommended - recommendedBase));
  const baseGap = numberFrom(result, ["baseGap"]);
  const topUpGap = numberFrom(result, ["topUpGap"]);

  return (
    <Card className="min-w-0 break-inside-avoid print:shadow-none">
      <CardHeader>
        <CardTitle id="health-cover-heading" className="flex items-center gap-2"><HeartPulse className="h-5 w-5" /> Health cover</CardTitle>
        <CardDescription>Compare family protection with an editable city and age-adjusted medical benchmark.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Family and location</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="health-city">City category</Label>
              <Select value={values.city} onValueChange={(city) => setValues((current) => ({ ...current, city }))}>
                <SelectTrigger id="health-city" data-testid="select-health-city"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="metro">Metro / tier 1</SelectItem>
                  <SelectItem value="tier-2">Tier 2</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumberField id="health-age" label="Age of eldest member" value={values.eldestAge} onChange={update("eldestAge")} />
            <NumberField id="health-adults" label="Adults covered" value={values.adults} onChange={update("adults")} min={1} />
            <NumberField id="health-children" label="Children covered" value={values.children} onChange={update("children")} />
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Current protection</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField id="health-employer" label="Employer cover" value={values.employerCover} onChange={update("employerCover")} step={10000} />
            <NumberField id="health-floater" label="Personal/floater cover" value={values.floaterCover} onChange={update("floaterCover")} step={10000} />
            <NumberField id="health-top-up" label="Top-up cover" value={values.topUpCover} onChange={update("topUpCover")} step={10000} />
          </div>
        </fieldset>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Medical cost and premium assumptions</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <NumberField id="health-benchmark-metro" label="Metro benchmark" value={values.benchmarks.metro} onChange={(value) => setValues((current) => ({ ...current, benchmarks: { ...current.benchmarks, metro: value } }))} step={50000} />
            <NumberField id="health-benchmark-tier-2" label="Tier 2 benchmark" value={values.benchmarks["tier-2"]} onChange={(value) => setValues((current) => ({ ...current, benchmarks: { ...current.benchmarks, "tier-2": value } }))} step={50000} />
            <NumberField id="health-benchmark-other" label="Other-city benchmark" value={values.benchmarks.other} onChange={(value) => setValues((current) => ({ ...current, benchmarks: { ...current.benchmarks, other: value } }))} step={50000} />
            <NumberField id="health-age-loading" label="Age loading" value={values.ageLoadingRate} onChange={update("ageLoadingRate")} suffix="%" step={0.1} />
            <NumberField id="health-premium-rate" label="Premium estimate rate" value={values.premiumRate} onChange={update("premiumRate")} suffix="%" step={0.1} />
          </div>
        </details>
        <div aria-live="polite" aria-atomic="true">
          <p className="sr-only">Estimated additional health cover is {formatINR(gap)}.</p>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <ResultTile label="Medical benchmark" value={formatINR(base)} testId="value-health-benchmark" />
            <ResultTile label="Current combined cover" value={formatINR(current)} testId="value-health-current" />
            <ResultTile label="Recommended base cover" value={formatINR(recommendedBase)} testId="value-health-recommended-base" />
            <ResultTile label="Recommended top-up" value={formatINR(recommendedTopUp)} testId="value-health-recommended-top-up" />
            <ResultTile label="Base cover gap" value={formatINR(baseGap)} tone={toneForDeficit(baseGap)} emphasis testId="value-health-base-gap" />
            <ResultTile label="Top-up gap" value={formatINR(topUpGap)} tone={toneForDeficit(topUpGap)} emphasis testId="value-health-top-up-gap" />
          </dl>
        </div>
        <div className="rounded-lg bg-muted/60 p-3 text-sm">
          <p className="font-medium">Unconfirmed estimated annual premium range</p>
          <p className="mt-1 tabular-nums text-muted-foreground">{formatINR(premiumLow)} – {formatINR(premiumHigh)} a year</p>
          <p className="mt-1 text-xs text-muted-foreground">Employer and floater cover address the base layer; a top-up is assessed separately and its deductible must be checked.</p>
        </div>
      </CardContent>
    </Card>
  );
}

type HousingInputs = {
  propertyPrice: number; downPayment: number; monthlyRent: number; loanRate: number; loanYears: number;
  horizonYears: number; appreciationRate: number; rentEscalationRate: number; investmentReturnRate: number;
  buyingCostsRate: number; saleCostsRate: number; annualOwnershipCostRate: number; rentalDeposit: number;
};

function RentVsBuyCalculator() {
  const housing = assumptions.housing;
  const market = assumptions.market;
  const [values, setValues] = useState<HousingInputs>({
    propertyPrice: 10000000, downPayment: 2000000, monthlyRent: 30000,
    loanRate: 8.5, loanYears: 20, horizonYears: 10,
    appreciationRate: defaultFrom(housing, ["propertyAppreciationRate", "appreciationRate"], 5),
    rentEscalationRate: defaultFrom(housing, ["rentEscalationRate"], 5),
    investmentReturnRate: defaultFrom(market, ["expectedReturnRate", "investmentReturnRate"], 9),
    buyingCostsRate: defaultFrom(housing, ["buyingCostsRate", "transactionCostRate"], 7), saleCostsRate: 2,
    annualOwnershipCostRate: defaultFrom(housing, ["annualOwnershipCostRate", "maintenanceRate"], 1),
    rentalDeposit: 100000,
  });
  const update = (key: keyof HousingInputs) => (value: number) => setValues((current) => ({ ...current, [key]: value }));
  const result = useMemo(() => (compareRentVsBuy as (input: NumericRecord) => unknown)({
    ...values,
    homePrice: values.propertyPrice,
    loanAnnualRate: values.loanRate,
    loanTenureMonths: values.loanYears * 12,
    horizonMonths: values.horizonYears * 12,
    mortgageRate: values.loanRate,
    mortgageYears: values.loanYears,
    propertyAppreciationRate: values.appreciationRate,
    annualAppreciationRate: values.appreciationRate,
    annualRentEscalationRate: values.rentEscalationRate,
    annualOpportunityReturnRate: values.investmentReturnRate,
    transactionCostRate: values.buyingCostsRate,
    purchaseCostRate: values.buyingCostsRate,
    saleCostRate: values.saleCostsRate,
    rentalDeposit: values.rentalDeposit,
    maintenanceRate: values.annualOwnershipCostRate,
  }), [values]);
  const buyCost = numberFrom(result, ["totalBuyCost", "buyNetCost", "buyingCost", "cumulativeOwnershipCost"]);
  const rentCost = numberFrom(result, ["totalRentCost", "rentNetCost", "rentingCost", "cumulativeRent"]);
  const renterNetWorth = numberFrom(result, ["renterNetWorth"]);
  const buyerNetWorth = numberFrom(result, ["buyerNetWorth"]);
  const opportunity = numberFrom(result, ["renterInvestmentBalance", "renterPortfolio", "renterOpportunityInvestment", "opportunityCost", "investmentOpportunityCost"], renterNetWorth - values.rentalDeposit);
  const difference = numberFrom(result, ["difference", "buyAdvantage", "netDifference"], buyerNetWorth - renterNetWorth);
  const durableBreakEven = nullableNumberFrom(result, ["breakEvenMonth", "durableBreakEvenMonth", "durableCrossingMonth"]);
  const winner = difference > 0 ? "Buying" : difference < 0 ? "Renting" : "Neither option";
  const effectiveDeposit = numberFrom(result, ["rentalDeposit"], values.rentalDeposit);
  const depositWasAdjusted = effectiveDeposit < values.rentalDeposit;

  return (
    <Card className="min-w-0 break-inside-avoid print:shadow-none">
      <CardHeader>
        <CardTitle id="rent-buy-heading" className="flex items-center gap-2"><Home className="h-5 w-5" /> Rent vs buy</CardTitle>
        <CardDescription>Compare long-term cash flows and the opportunity cost of tying up a deposit.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Home and financing</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberField id="housing-price" label="Property price" value={values.propertyPrice} onChange={update("propertyPrice")} step={100000} />
            <NumberField id="housing-down-payment" label="Down payment" value={values.downPayment} onChange={update("downPayment")} step={10000} />
            <NumberField id="housing-rent" label="Current monthly rent" value={values.monthlyRent} onChange={update("monthlyRent")} step={1000} />
            <NumberField id="housing-rental-deposit" label="Refundable rental deposit" value={values.rentalDeposit} onChange={update("rentalDeposit")} max={values.downPayment + values.propertyPrice * values.buyingCostsRate / 100} step={10000} />
            <NumberField id="housing-loan-rate" label="Home-loan rate" value={values.loanRate} onChange={update("loanRate")} suffix="%" step={0.1} />
            <NumberField id="housing-loan-years" label="Loan tenure" value={values.loanYears} onChange={update("loanYears")} suffix="years" />
            <NumberField id="housing-horizon" label="Comparison horizon" value={values.horizonYears} onChange={update("horizonYears")} suffix="years" />
          </div>
        </fieldset>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Growth, cost and return assumptions</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberField id="housing-appreciation" label="Appreciation" value={values.appreciationRate} onChange={update("appreciationRate")} suffix="%" step={0.1} />
            <NumberField id="housing-rent-growth" label="Rent escalation" value={values.rentEscalationRate} onChange={update("rentEscalationRate")} suffix="%" step={0.1} />
            <NumberField id="housing-invest-return" label="Investment return" value={values.investmentReturnRate} onChange={update("investmentReturnRate")} suffix="%" step={0.1} />
            <NumberField id="housing-buy-costs" label="Buying costs" value={values.buyingCostsRate} onChange={update("buyingCostsRate")} suffix="%" step={0.1} />
            <NumberField id="housing-sale-costs" label="Selling costs" value={values.saleCostsRate} onChange={update("saleCostsRate")} suffix="%" step={0.1} />
            <NumberField id="housing-owner-cost" label="Annual owner costs" value={values.annualOwnershipCostRate} onChange={update("annualOwnershipCostRate")} suffix="%" step={0.1} />
          </div>
        </details>
        {depositWasAdjusted && (
          <Alert>
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Rental deposit adjusted for comparison</AlertTitle>
            <AlertDescription>
              The model uses {formatINR(effectiveDeposit)}, matching the maximum initial cash allocated to the buying option.
            </AlertDescription>
          </Alert>
        )}
        <div aria-live="polite" aria-atomic="true">
          <p className="sr-only">{winner} is ahead by {formatINR(Math.abs(difference))} in modelled net worth.</p>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ResultTile label="Owner outflows (excl. down payment)" value={formatINR(buyCost)} testId="value-buy-cost" />
            <ResultTile label="Cumulative rent paid" value={formatINR(rentCost)} testId="value-rent-cost" />
            <ResultTile label="Renter opportunity investment" value={formatINR(opportunity)} tone={toneForAmount(opportunity)} testId="value-housing-opportunity-cost" />
            <ResultTile label="Renter net worth" value={formatINR(renterNetWorth)} testId="value-renter-net-worth" />
            <ResultTile label="Buyer net worth" value={formatINR(buyerNetWorth)} testId="value-buyer-net-worth" />
            <ResultTile label={difference === 0 ? "Modelled outcome" : `${winner} ahead`} value={difference === 0 ? "Tied" : formatINR(Math.abs(difference))} tone={difference === 0 ? "neutral" : "positive"} emphasis testId="value-housing-difference" />
          </dl>
        </div>
        <div className="rounded-lg border p-3 text-sm"><span className="text-muted-foreground">Break-even timing</span><p className="mt-1 font-semibold">{durableBreakEven !== null ? `Buying remains ahead from month ${durableBreakEven} (durable crossing)` : "No durable break-even within the horizon"}</p></div>
      </CardContent>
    </Card>
  );
}

type PrepayInputs = { extraPayment: number; monthlyExtraPayment: number; horizonYears: number; expectedReturnRate: number; returnRange: number; taxRate: number };

function PrepayVsInvestCalculator({ loans, loading }: { loans: Loan[]; loading: boolean }) {
  const market = assumptions.market ?? assumptions.prepay;
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [values, setValues] = useState<PrepayInputs>({
    extraPayment: 100000, monthlyExtraPayment: 0, horizonYears: 10,
    expectedReturnRate: defaultFrom(market, ["expectedReturnRate", "investmentReturnRate"], 9),
    returnRange: defaultFrom(market, ["returnUncertainty", "returnRange"], 3),
    taxRate: defaultFrom(market, ["investmentTaxRate", "taxRate"], 15),
  });
  const eligibleLoans = loans.filter((loan) => Number(loan.outstandingPrincipal) > 0);
  const selectedLoan = eligibleLoans.find((loan) => loan.id === selectedLoanId) ?? eligibleLoans[0];
  const remainingMonths = selectedLoan ? loanPayoffDetails(selectedLoan).remainingMonths : 0;
  const minimumHorizonYears = Math.max(1, Math.ceil(remainingMonths / 12));
  const update = (key: keyof PrepayInputs) => (value: number) => setValues((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (remainingMonths <= 0) return;
    setValues((current) => current.horizonYears >= minimumHorizonYears
      ? current
      : { ...current, horizonYears: minimumHorizonYears });
  }, [minimumHorizonYears, remainingMonths]);
  const result = useMemo(() => {
    if (!selectedLoan) return null;
    return (comparePrepayVsInvest as (input: Record<string, unknown>) => unknown)({
      ...values,
      loan: selectedLoan,
      loanPrincipal: selectedLoan.outstandingPrincipal,
      outstandingPrincipal: selectedLoan.outstandingPrincipal,
      annualInterestRate: selectedLoan.annualInterestRate,
      annualLoanRate: selectedLoan.annualInterestRate,
      principal: selectedLoan.outstandingPrincipal,
      repaymentType: selectedLoan.repaymentType ?? "emi",
      emi: selectedLoan.emi,
      tenureMonths: remainingMonths,
      remainingMonths,
      horizonMonths: Math.max(values.horizonYears * 12, remainingMonths),
      investmentReturnRate: values.expectedReturnRate,
      annualInvestmentReturn: values.expectedReturnRate,
      annualReturnRiskRange: {
        low: values.expectedReturnRate - values.returnRange,
        high: values.expectedReturnRate + values.returnRange,
      },
      investmentTaxRate: values.taxRate,
      extraPrepayment: values.extraPayment,
      initialExtraPayment: values.extraPayment,
      monthlyExtraPayment: values.monthlyExtraPayment,
    });
  }, [selectedLoan, values]);
  const effectiveHorizonMonths = numberFrom(result, ["horizonMonths"], Math.max(values.horizonYears * 12, remainingMonths));
  const interestSaved = numberFrom(result, ["interestSaved", "prepaymentInterestSaved"]);
  const prepayValue = numberFrom(result, ["prepayValue", "prepaymentBenefit", "prepayFutureValue"], numberAt(result, ["prepayPortfolioValues", "expected"]));
  const investValue = numberFrom(result, ["investmentValue", "afterTaxInvestmentValue"], numberAt(result, ["investmentValues", "expected"]));
  const opportunity = numberFrom(result, ["expectedAdvantage", "opportunityCost", "investmentOpportunityCost"], prepayValue - investValue);
  const breakEven = nullableNumberFrom(result, ["breakEvenInvestmentReturn", "breakEvenReturnRate", "breakEvenRate"]);
  const low = numberFrom(result, ["uncertaintyLow"], numberAt(result, ["terminalIncrementalPortfolioValues", "low"]));
  const expected = numberFrom(result, ["expectedAdvantage"], numberAt(result, ["terminalIncrementalPortfolioValues", "expected"]));
  const high = numberFrom(result, ["uncertaintyHigh"], numberAt(result, ["terminalIncrementalPortfolioValues", "high"]));
  const expectedWinner = opportunity > 0 ? "Prepaying is ahead" : opportunity < 0 ? "Investing is ahead" : "The expected result is tied";
  const strategyDifference = (value: number) => value === 0
    ? <span>Tied</span>
    : <span className="text-positive">{value > 0 ? "Prepay" : "Invest"} +{formatINR(Math.abs(value))}</span>;

  return (
    <Card className="min-w-0 break-inside-avoid print:shadow-none">
      <CardHeader>
        <CardTitle id="prepay-heading" className="flex items-center gap-2"><WalletCards className="h-5 w-5" /> Prepay vs invest</CardTitle>
        <CardDescription>Compare a certain reduction in loan cost with an uncertain, after-tax investment outcome.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Loan and amount</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="prepay-loan">Saved loan</Label>
              <Select value={selectedLoan?.id ?? ""} onValueChange={setSelectedLoanId} disabled={loading || eligibleLoans.length === 0}>
                <SelectTrigger id="prepay-loan" data-testid="select-prepay-loan"><SelectValue placeholder={loading ? "Loading loans…" : "Choose a loan"} /></SelectTrigger>
                <SelectContent>
                  {eligibleLoans.map((loan) => (
                    <SelectItem key={loan.id} value={loan.id}>{loan.name} · {(loan.repaymentType ?? "emi").replaceAll("-", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">EMI, bullet and interest-only + bullet loans are supported.</p>
            </div>
            <NumberField id="prepay-amount" label="Extra amount available" value={values.extraPayment} onChange={update("extraPayment")} step={1000} />
            <NumberField id="prepay-monthly-amount" label="Extra amount each month" value={values.monthlyExtraPayment} onChange={update("monthlyExtraPayment")} step={500} />
            <NumberField id="prepay-horizon" label="Comparison horizon" value={values.horizonYears} onChange={(value) => update("horizonYears")(Math.max(value, minimumHorizonYears))} min={minimumHorizonYears} suffix="years" />
          </div>
        </fieldset>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Investment return, tax and risk assumptions</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <NumberField id="prepay-return" label="Expected annual return" value={values.expectedReturnRate} onChange={update("expectedReturnRate")} suffix="%" step={0.1} />
            <NumberField id="prepay-return-range" label="Return uncertainty" value={values.returnRange} onChange={update("returnRange")} suffix="± %" step={0.1} />
            <NumberField id="prepay-tax" label="Tax on investment gains" value={values.taxRate} onChange={update("taxRate")} suffix="%" step={0.1} />
          </div>
        </details>
        {!selectedLoan ? (
          <Alert>
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>No active saved loan</AlertTitle>
            <AlertDescription>Add a loan with an outstanding principal, or pass loans to this page, to run this comparison.</AlertDescription>
          </Alert>
        ) : (
          <>
            <div aria-live="polite" aria-atomic="true">
              <p className="mb-3 text-xs text-muted-foreground" data-testid="value-prepay-effective-horizon">
                Compared through month {effectiveHorizonMonths}, at least the saved loan&apos;s remaining payoff period.
              </p>
              <p className="sr-only">Terminal prepayment benefit is {formatINR(prepayValue)} and terminal investment benefit is {formatINR(investValue)}. {expectedWinner}.</p>
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <ResultTile label="Interest saved" value={formatINR(interestSaved)} tone={toneForAmount(interestSaved)} testId="value-prepay-interest-saved" />
                <ResultTile label="Terminal prepayment benefit" value={formatINR(prepayValue)} tone={toneForAmount(prepayValue)} testId="value-prepay-benefit" />
                <ResultTile label="Terminal investing benefit" value={formatINR(investValue)} tone={toneForAmount(investValue)} testId="value-invest-value" />
                <ResultTile label={expectedWinner} value={formatINR(Math.abs(opportunity))} tone={opportunity === 0 ? "neutral" : "positive"} emphasis testId="value-prepay-opportunity-cost" />
              </dl>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3 text-sm"><span className="text-muted-foreground">Break-even investment return</span><p data-testid="value-prepay-break-even" className="mt-1 font-semibold tabular-nums">{breakEven !== null ? `${breakEven.toFixed(1)}% a year` : "No break-even in the modelled range"}</p></div>
              <div className="rounded-lg bg-muted/60 p-3 text-sm">
                <p className="font-medium">Strategy advantage as returns vary</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-muted-foreground">Low return</dt><dd className="mt-1 font-medium tabular-nums">{strategyDifference(low)}</dd></div>
                  <div><dt className="text-muted-foreground">Expected</dt><dd className="mt-1 font-medium tabular-nums">{strategyDifference(expected)}</dd></div>
                  <div><dt className="text-muted-foreground">High return</dt><dd className="mt-1 font-medium tabular-nums">{strategyDifference(high)}</dd></div>
                </dl>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Prepayment calculations use the selected loan’s {selectedLoan.repaymentType ?? "emi"} repayment structure. Market returns are not guaranteed, while floating loan rates can also change.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function DecisionTools() {
  const loansQuery = useLoans();
  const loans = loansQuery.data ?? [];
  const staleWarnings = staleAssumptionWarnings();

  return (
    <main className="min-w-0 space-y-6 pb-12 animate-in fade-in duration-500 print:space-y-4 print:pb-0">
      <header className="flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between print:pb-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary"><Calculator className="h-4 w-4" /> Editable planning calculators</div>
          <h1 className="font-serif text-2xl text-primary md:text-3xl">Decision tools</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground md:text-base">Explore protection, housing and debt choices with consistent, editable assumptions.</p>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground" data-testid="text-assumption-version">
          <p><strong className="text-foreground">Assumptions {assumptions.version ?? "current"}</strong></p>
          <p>Source date: {assumptions.sourceDate ?? "See methodology"}</p>
        </div>
      </header>

      <Alert>
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>Educational estimates, not financial advice</AlertTitle>
        <AlertDescription>These calculators simplify future costs and returns. They do not assess policy wording, underwriting, taxes, liquidity needs or your complete circumstances. Verify quotes and consider qualified professional advice before acting.</AlertDescription>
      </Alert>
      {staleWarnings.length > 0 && (
        <Alert variant="destructive" data-testid="status-stale-assumptions">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Assumptions may be stale</AlertTitle>
          <AlertDescription>
            The source date is outside the maintained freshness window. Review editable values before relying on these comparisons.
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {staleWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <nav aria-label="Decision tool sections" className="grid grid-cols-2 gap-2 print:hidden md:grid-cols-4">
        {[
          ["life-cover-heading", "Life cover"],
          ["health-cover-heading", "Health cover"],
          ["rent-buy-heading", "Rent vs buy"],
          ["prepay-heading", "Prepay vs invest"],
        ].map(([id, label]) => <a key={id} href={`#${id}`} data-testid={`link-${id}`} className="rounded-lg border bg-card px-3 py-2 text-center text-sm font-medium hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</a>)}
      </nav>

      <section aria-label="Insurance decision tools" className="grid min-w-0 gap-6 xl:grid-cols-2 print:block print:space-y-4">
        <LifeCoverCalculator />
        <HealthCoverCalculator />
      </section>
      <section aria-label="Housing and debt decision tools" className="grid min-w-0 gap-6 xl:grid-cols-2 print:block print:space-y-4">
        <RentVsBuyCalculator />
        <PrepayVsInvestCalculator loans={loans} loading={loansQuery.isLoading} />
      </section>

      <aside className="rounded-xl border bg-muted/40 p-4 text-sm print:break-inside-avoid">
        <h2 className="font-semibold">How to use these results</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Use ranges rather than a single outcome; small changes in inflation, returns and medical costs compound.</li>
          <li>A “lower cost” result does not capture flexibility, risk tolerance, exclusions, deductibles or peace of mind.</li>
          <li>Save evidence for confirmed premiums and costs separately; estimates shown here should not automatically become expenses.</li>
        </ul>
        <details className="mt-4 border-t pt-3">
          <summary className="cursor-pointer font-semibold">Assumption sources and dates</summary>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {Object.entries(DECISION_TOOL_ASSUMPTIONS).map(([area, source]) => (
              <div key={area} className="rounded-lg bg-background p-3">
                <dt className="font-medium capitalize">{area.replace(/([A-Z])/g, " $1")}</dt>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {source.version} · sourced {source.sourceDate}
                  <span className="mt-1 block">{source.sources.join("; ")}</span>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </aside>
    </main>
  );
}