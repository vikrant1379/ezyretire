# Chart

- Source: `artifacts/wealthone-expenses/src/components/ui/chart.tsx`
- Usage evidence: 0 application imports found; catalog story: `src/preview/demos/chart.tsx`.
- Dependencies: React, Recharts, `cn`.
- Public API: `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartStyle`; `ChartConfig` is exported as a type.
- Behavior: Scopes chart CSS variables by generated id, maps named config to Recharts tooltip/legend content, and supports theme-specific series colors.