import { useMemo, useState } from "react";
import { useIncomeSources } from "@/hooks/use-income";
import { useInvestments } from "@/hooks/use-investments";
import { formatINR } from "@/lib/utils";
import {
  buildTaxSummary,
  type TaxFinancialYear,
  type TaxRegime,
  type TaxSummary,
} from "@/lib/tax-summary";
import { financialYearForDate, INDIAN_INCOME_TAX_RULES } from "@/lib/income-tax";
import { Badge } from "@workspace/wealthone-design-system/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@workspace/wealthone-design-system/components/ui/alert";
import { Calculator, CircleAlert, IndianRupee, Landmark, ReceiptText, TriangleAlert } from "lucide-react";

type NumericSummaryKey = {
  [Key in keyof TaxSummary]: TaxSummary[Key] extends number ? Key : never
}[keyof TaxSummary];

const rows: Array<{ key: NumericSummaryKey; label: string; subtract?: boolean }> = [
  { key: "grossIncome", label: "Gross income included" },
  { key: "standardDeduction", label: "Standard deduction", subtract: true },
  { key: "investmentDeduction", label: "Supported investment deductions", subtract: true },
  { key: "taxableIncome", label: "Estimated taxable income" },
  { key: "slabTax", label: "Income tax from slabs" },
  { key: "rebate", label: "Rebate / marginal relief", subtract: true },
  { key: "surcharge", label: "Surcharge after relief" },
  { key: "cess", label: "Health & education cess (4%)" },
];
const supportedFinancialYears = Object.keys(INDIAN_INCOME_TAX_RULES) as TaxFinancialYear[];
const calendarFinancialYear = financialYearForDate(new Date());
const defaultFinancialYear = supportedFinancialYears.includes(calendarFinancialYear as TaxFinancialYear)
  ? calendarFinancialYear as TaxFinancialYear
  : supportedFinancialYears.at(-1) ?? "2026-27";

function Breakdown({ summary }: { summary: TaxSummary }) {
  return (
    <dl className="divide-y" aria-label="Tax calculation breakdown">
      {rows.map(({ key, label, subtract }) => (
        <div key={key} className="flex items-center justify-between gap-4 py-3 text-sm">
          <dt className={key === "taxableIncome" ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
          <dd className="shrink-0 tabular-nums font-medium">
            {subtract && summary[key] > 0 ? "− " : ""}{formatINR(summary[key])}
          </dd>
        </div>
      ))}
      {summary.capitalGainsTax > 0 && (
        <div className="flex items-center justify-between gap-4 py-3 text-sm">
          <dt className="text-muted-foreground">Tax on gains at special rates</dt>
          <dd className="shrink-0 tabular-nums font-medium" data-testid="value-special-rate-tax">
            {formatINR(summary.capitalGainsTax)}
          </dd>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 pt-4 text-base font-semibold">
        <dt>Estimated annual tax</dt>
        <dd className="tabular-nums text-primary">{formatINR(summary.totalTax)}</dd>
      </div>
    </dl>
  );
}

export default function Tax() {
  const { data: sources = [], isLoading: incomeLoading } = useIncomeSources();
  const { data: investments = [], isLoading: investmentsLoading } = useInvestments();
  const [financialYear, setFinancialYear] = useState<TaxFinancialYear>(defaultFinancialYear);
  const [regime, setRegime] = useState<TaxRegime>("new");
  const summaries = useMemo(() => ({
    new: buildTaxSummary(sources, investments, "new", financialYear),
    old: buildTaxSummary(sources, investments, "old", financialYear),
  }), [sources, investments, financialYear]);
  const selected = summaries[regime];
  const saving = Math.abs(summaries.new.totalTax - summaries.old.totalTax);
  const lowerRegime = summaries.new.totalTax <= summaries.old.totalTax ? "New" : "Old";
  const capitalGainTreatments = selected.disposalTreatments;

  if (incomeLoading || investmentsLoading) {
    return <p className="py-16 text-center text-muted-foreground">Preparing your tax estimate…</p>;
  }

  return (
    <div className="space-y-6 md:space-y-8 pb-12 animate-in fade-in duration-500">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <Calculator className="h-4 w-4" /> Indian income tax estimator
          </div>
          <h1 className="font-serif text-2xl md:text-3xl text-primary">Tax</h1>
          <p className="mt-1 max-w-2xl text-sm md:text-base text-muted-foreground">
            See how saved income occurrences and supported investments affect an indicative tax estimate.
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-3 rounded-xl border bg-card p-3 sm:w-auto">
          <div className="space-y-1.5">
            <Label htmlFor="tax-financial-year">Financial year</Label>
            <Select value={financialYear} onValueChange={(value) => setFinancialYear(value as TaxFinancialYear)}>
              <SelectTrigger id="tax-financial-year" className="min-w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[...supportedFinancialYears].reverse().map((year) => (
                  <SelectItem key={year} value={year}>FY {year.replace("-", "–")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax-regime">Tax regime</Label>
            <Select value={regime} onValueChange={(value) => setRegime(value as TaxRegime)}>
              <SelectTrigger id="tax-regime" className="min-w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New regime</SelectItem>
                <SelectItem value="old">Old regime</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <Alert>
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>Planning estimate, not a tax return</AlertTitle>
        <AlertDescription>
          Recurring ordinary income is prorated to active months, and dated ordinary one-time income is included when it falls in this FY.
          Completed investment disposals with the required details are included under the supported capital-gains rules.
          HRA exemption, home-loan benefits and deductions not listed below are not modelled.
        </AlertDescription>
      </Alert>

      <section aria-labelledby="regime-comparison-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="regime-comparison-heading" className="font-serif text-lg md:text-xl">Regime comparison</h2>
          <Badge variant="secondary">{lowerRegime} regime is lower by {formatINR(saving)}</Badge>
        </div>
        <div className="grid gap-3 md:gap-4 md:grid-cols-2">
          {(["new", "old"] as const).map((item) => {
            const summary = summaries[item];
            const active = item === regime;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setRegime(item)}
                aria-pressed={active}
                className={`rounded-xl border bg-card p-4 md:p-5 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary ring-1 ring-primary" : "hover:border-primary/40"}`}
              >
                <span className="flex items-center justify-between">
                  <span className="font-semibold capitalize text-sm md:text-base">{item} regime</span>
                  {active && <Badge>Selected</Badge>}
                </span>
                <span className="mt-3 md:mt-5 block text-2xl md:text-3xl font-bold tabular-nums">{formatINR(summary.totalTax)}</span>
                <span className="mt-1 block text-xs md:text-sm text-muted-foreground">
                  {formatINR(summary.totalTax / 12)} average per month
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4" aria-label="Tax position summary">
        <Card className="flex flex-col">
          <CardHeader className="p-4 md:p-6 md:pb-2 pb-2"><CardDescription className="text-xs">Estimated liability</CardDescription></CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0 text-xl md:text-2xl font-bold tabular-nums">{formatINR(selected.totalTax)}</CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader className="p-4 md:p-6 md:pb-2 pb-2"><CardDescription className="text-xs">Employer TDS</CardDescription></CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0 text-xl md:text-2xl font-bold tabular-nums">{formatINR(selected.tdsWithheld)}</CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader className="p-4 md:p-6 md:pb-2 pb-2"><CardDescription className="text-xs">Automatic TDS</CardDescription></CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
            <p className="text-xl md:text-2xl font-bold tabular-nums">{formatINR(selected.automaticTdsEstimate)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground leading-tight">Not counted as already withheld</p>
          </CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader className="p-4 md:p-6 md:pb-2 pb-2"><CardDescription className="text-xs truncate">{selected.balanceTax >= 0 ? "Estimated balance" : "Potential excess"}</CardDescription></CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0 text-xl md:text-2xl font-bold tabular-nums text-primary">{formatINR(Math.abs(selected.balanceTax))}</CardContent>
        </Card>
      </section>

      <section aria-labelledby="capital-gains-heading">
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle id="capital-gains-heading" className="flex items-center gap-2 text-base md:text-lg">
              <Landmark className="h-5 w-5" /> Realized capital gains
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              Based only on completed purchase and sale records in the selected financial year.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0 space-y-4 md:space-y-5">
            <div className="grid gap-3 md:gap-4 grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-[10px] md:text-xs text-muted-foreground">Realized gains included</p>
                <p className="mt-1 text-base md:text-lg font-semibold tabular-nums" data-testid="value-realized-included-gains">
                  {formatINR(selected.taxableCapitalGains)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Short-term gains</p>
                <p className="mt-1 text-lg font-semibold tabular-nums" data-testid="value-short-term-gains">
                  {formatINR(selected.shortTermCapitalGains)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Long-term gains</p>
                <p className="mt-1 text-lg font-semibold tabular-nums" data-testid="value-long-term-gains">
                  {formatINR(selected.longTermCapitalGains)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Tax at special rates</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-primary" data-testid="value-capital-gains-tax">
                  {formatINR(selected.capitalGainsTax)}
                </p>
              </div>
            </div>

            {capitalGainTreatments.length > 0 && (
              <div className="space-y-3" aria-label="Disposal tax treatments">
                <h3 className="text-sm font-semibold">Disposal-by-disposal treatment</h3>
                {capitalGainTreatments.map((treatment, index) => {
                  const excluded = treatment.status === "excluded";
                  return (
                    <div
                      key={treatment.id ?? index}
                      className="rounded-lg border p-3 text-sm"
                      data-testid={`card-disposal-treatment-${treatment.id ?? index}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {treatment.name || `Disposal ${index + 1}`}
                          </p>
                          {treatment.holdingPeriod && treatment.holdingPeriod !== "not-applicable" && (
                            <p className="text-xs capitalize text-muted-foreground">
                              {treatment.holdingPeriod}
                              {treatment.rate === "slab"
                                ? " · slab rate"
                                : typeof treatment.rate === "number"
                                  ? ` · ${treatment.rate * 100}% rate`
                                  : ""}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <Badge variant={excluded ? "outline" : "secondary"}>
                            {excluded ? "Excluded" : "Included"}
                          </Badge>
                          <p className="mt-1 font-semibold tabular-nums">{formatINR(treatment.gain)}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {treatment.treatment}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
            {capitalGainTreatments.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No completed investment disposals were recorded for FY {financialYear}.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,.65fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><IndianRupee className="h-5 w-5" /> {regime === "new" ? "New" : "Old"} regime breakdown</CardTitle>
            <CardDescription>Amounts are annual and rounded only for display.</CardDescription>
          </CardHeader>
          <CardContent><Breakdown summary={selected} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5" /> What was included</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground">Salary income</p>
              <p className="text-lg font-semibold tabular-nums">{formatINR(selected.salaryIncome)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Other recurring income</p>
              <p className="text-lg font-semibold tabular-nums">{formatINR(selected.otherIncome)}</p>
            </div>
            <div className="rounded-lg bg-muted/60 p-3 text-muted-foreground">
              Old-regime investment deductions include saved monthly EPF/PPF contributions under the shared
              ₹1.5 lakh 80C cap and NPS contributions up to ₹50,000. Eligibility is not verified.
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5" /> Source-by-source treatment</CardTitle>
            <CardDescription>How each saved source is handled for FY {financialYear}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {selected.sourceTreatments.length === 0
              ? <p className="text-muted-foreground">No income sources are recorded.</p>
              : selected.sourceTreatments.map((source) => (
                <div key={source.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{source.name}</p>
                      <p className="text-xs text-muted-foreground">{source.type}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant={source.status === "included" ? "secondary" : "outline"}>
                        {source.status === "included" ? "Included" : "Excluded"}
                      </Badge>
                      <p className="mt-1 font-semibold tabular-nums">{formatINR(source.amount)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{source.treatment}</p>
                </div>
              ))}
            <p className="text-muted-foreground">
              Current portfolio appreciation is not treated as a realized gain. Only recorded completed disposals
              are assessed; missing holding-period, asset-type or exemption details are not guessed.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TriangleAlert className="h-5 w-5" /> Assumptions and warnings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              {selected.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
              {selected.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
            <p className="font-medium">Use this for planning only. Consult a qualified tax professional for filing decisions.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}