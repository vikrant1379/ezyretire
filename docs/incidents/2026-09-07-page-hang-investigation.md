# Page hang investigation — 7 September 2026

## Conclusion

The most likely cause is synchronous retirement-readiness work on the client, not an oversized or malformed financial record and not a slow database query.

- **Defect confidence:** high. A redacted reproduction with the affected account's collection shape spends about **1.9 seconds** in `calculateRetirementReadiness` on the workspace CPU.
- **Incident attribution confidence:** medium. The available evidence confirms a mobile login in the reported interval, but historical request/deployment logs were unavailable, so the exact page and browser main-thread duration cannot be proven after the fact.
- **Product fix warranted:** yes. The Dashboard and Retirement pages can appear frozen while readiness calculations repeatedly build complete projections on the browser's main thread.
- **Production data repair warranted:** no. No malformed or implausibly large record was found, and no production data was changed.

## Scope and privacy

The account was resolved by an exact, whitespace-normalized, case-insensitive full-name match. The query returned exactly one account and no duplicate match. The committed report excludes the account's name, identifiers, financial values, and free-text fields.

The investigation used read-only queries against the application's configured Neon database. The snapshot reflects the data available on 8 September 2026; the application does not retain row-version history that could reconstruct the exact financial document from the previous day.

The incident interval was **7 September 2026, 00:00–24:00 IST**, matching the project's IST timestamp convention.

## Data profile

| Collection | Affected account |
| --- | ---: |
| Expenses | 0 |
| Budgets | 10 |
| Budget schedules | 11 |
| Income sources | 1 |
| Investments | 0 |
| Fund allocations | 0 |
| Investment disposals | 0 |
| Loans | 1 |

Additional checks:

- The normalized `financial-data` response was **4,250 bytes**. A database-side JSON estimate using raw rows was **4,952 bytes**.
- Across the 14 accounts in the database, the affected account's stored financial rows were below the 95th percentile. They were 7.27 times the all-account median only because most accounts were empty or nearly empty.
- There were no expense dates to render or aggregate.
- Income and loan date strings matched the expected date format.
- All budget schedule values were JSON objects. Schedule starts ranged from the deliberate legacy `1900-01` sentinel through `2027-09`; custom ends ranged from `2027-03` through `2027-09`.
- No negative budget was found. Names, notes, JSON documents, and numeric magnitudes were within ordinary schema bounds; no unusually long free text or out-of-range financial magnitude was found.

This shape cannot explain a transaction-list rendering hang: the account has no expense rows. It also cannot explain an Investments-page list hang: the account has no investment rows.

## Operational evidence

- One successful login-activity row exists in the interval, at **18:50:08 IST**, from a mobile Chrome browser.
- The app's Pino HTTP middleware records request method, path, status, and response completion timing, but the deployment log service returned no retained entries for the incident interval. There is therefore no historical `/financial-data` status or response-time record to correlate with the login.
- The database does not have `pg_stat_statements` enabled, and historical lock/latency evidence was unavailable.
- A read-only aggregate query over the affected account's financial tables executed in **0.163 ms** in PostgreSQL.
- Twelve end-to-end `loadFinancialData` reads from the workspace to Neon produced a warm median of **331.8 ms**, p95 of **333.3 ms**, and maximum of **334.2 ms**. This includes network round trips from the diagnostic environment and serialization; it is not evidence of a production request stall.

No available evidence indicates an authentication failure, database lock, failed save, or abnormally slow financial-data query.

## Safe reproduction

A synthetic fixture preserved the observed collection cardinalities, schedule count, retirement horizon, and non-sensitive date semantics while replacing names and all financial values.

Twenty-five warm measurements produced:

| Work | Median | p95 | Maximum |
| --- | ---: | ---: | ---: |
| One retirement projection | 36.78 ms | 42.26 ms | 46.62 ms |
| Retirement readiness | 1,949.34 ms | 2,008.66 ms | 2,030.24 ms |

Isolation measurements:

| Synthetic variant | Median readiness time |
| --- | ---: |
| Affected shape: 10 budgets / 11 schedules | 1,894.4 ms |
| Same age horizon: 1 budget / 1 schedule | 322.1 ms |
| Typical age horizon: 10 budgets / 11 schedules | 1,213.8 ms |

The affected shape has a 164-month accumulation horizon and a 45-year retirement horizon. These are valid planning inputs, not malformed edge cases.

## Root cause

`calculateRetirementReadiness` searches candidate retirement ages twice. Every candidate calls `calculateRetirementProjection`, which rebuilds monthly cash-flow timelines, retirement drawdown calculations, yearly chart data, budget totals, and other result sections that the candidate-age search does not need.

The Dashboard then calls `calculateRetirementProjection` separately before calling `calculateRetirementReadiness`, whose first step calculates the same current projection again. Budget schedules are repeatedly scanned throughout these projections. The result is multiplicative synchronous work on the main thread; legitimate combinations of a young current age, long life expectancy, and several budget schedules amplify it.

On the workspace CPU this blocks for about two seconds. A lower-power mobile device can block longer, matching a report that the page appeared hung shortly after a mobile login.

## Recommended fix and regression scope

1. Extract a lightweight, reusable projection core for candidate-age feasibility. It should calculate only the values needed to decide whether the gap is funded and must not build chart data, yearly outlooks, or presentation timelines for every candidate.
2. Compute invariant normalized inputs and budget schedules once per readiness calculation, then reuse them across candidate ages.
3. Let `calculateRetirementReadiness` accept or return the already-computed current projection so Dashboard and Retirement do not calculate it twice.
4. Keep the age search linear unless monotonicity is formally established for scheduled incomes, loans, budgets, and lump sums; a speculative binary search could return the wrong age.
5. Add a regression fixture matching the redacted 10-budget/11-schedule, young-age, long-retirement shape. Assert output parity with the current algorithm, assert that candidate checks do not construct chart data, and add a generous performance ceiling that fails the current multi-second implementation without being flaky in CI.
6. Add client performance telemetry for financial-data fetch duration and retirement-readiness duration so future reports can distinguish network waiting from main-thread calculation.

No production data should be edited as part of this remediation.