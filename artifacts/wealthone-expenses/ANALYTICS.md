# Budget planning analytics

Replit Analytics automatically records the `/budgets` page view. Custom events below measure planning outcomes without sending amounts, dates, notes, category names, or custom text.

| Description | Event name |
| --- | --- |
| Future planning is enabled or disabled | `future_planning_toggled` |
| A future plan period is added | `budget_period_added` |
| A plan period is duplicated | `budget_period_duplicated` |
| A plan period is removed | `budget_period_removed` |
| A period ending mode is chosen | `budget_end_mode_selected` |
| A displayed timeline warning type is resolved | `budget_warning_resolved` |
| A budget plan is successfully saved | `budget_plan_saved` |
| The planning-category dialog is opened | `planning_category_opened` |
| An optional or custom planning category is successfully added | `planning_category_added` |

Safe event dimensions are limited to category type (`core`, `optional`, or `custom`), ending mode, period count, overlap/warning presence, future-planning status, and warning type.

## Useful funnels

1. `/budgets` page view → `future_planning_toggled` with `enabled: true` → `budget_plan_saved` with `future_planning: true`
2. `/budgets` page view → `planning_category_opened` → `planning_category_added` → `budget_plan_saved`
3. `/budgets` page view → `budget_warning_resolved` → `budget_plan_saved` with `warning_present: false`

Break completed saves down by `end_mode`, `period_count`, `overlap_present`, and `category_type` to learn which planning tools are retained in successful plans.

## Export analytics

Successful export download initiation is recorded without filenames, financial values, sheet counts, email addresses, or other user data.

| Description | Event name |
| --- | --- |
| A complete plan, transaction report, or backup download starts successfully | `export_downloaded` |

Use the `export_type` property to compare `complete_plan`, `transaction_report`, and `backup`.

After publishing, open the app's Analytics page, select the `export_downloaded` custom event, and break it down by `export_type`. Go to Publishing settings, enable analytics, and publish or republish the app before expecting these events to appear.


## Retirement planning analytics

Replit Analytics automatically records the `/retirement` page view. These custom events measure the chart-first planning journey without sending pension names, financial amounts, dates, or other free-form user content.

| Description | Event name |
| --- | --- |
| A lifestyle option is selected and previewed in the projection | `retirement_lifestyle_previewed` |
| The secondary detailed planner is opened | `retirement_planner_opened` |
| A retirement plan is successfully saved | `retirement_plan_saved` |

Safe dimensions are limited to the lifestyle category, target retirement age, years in retirement, active pension-source count, automatic or custom contribution mode, whether the planner was used, and funded or shortfall status.

## Financial Health summary analytics

The dashboard's compact Financial Health summary records an activation when a user follows it to the Financial Health details page. Keyboard and pointer activations use the same event.

| Description | Event name |
| --- | --- |
| The compact dashboard Financial Health summary is activated | `financial_health_summary_opened` |
| The detailed Financial Health next-step link is activated | `financial_health_action_opened` |
| A Financial Health snapshot or emergency-fund configuration is successfully saved | `financial_health_update_completed` |
| A loan is successfully added or updated | `financial_health_update_completed` |
| An income source is successfully added or updated | `financial_health_update_completed` |
| A transaction is successfully created, edited, or imported | `expense_save_succeeded` |
| Guided setup successfully saves the first projection | `first_projection_saved` |

`financial_health_summary_opened` uses only the coarse `state`: `incomplete`, `healthy`, `warning`, or `critical`.

`financial_health_action_opened` uses only the coarse `destination`: `financial_health`, `loans`, `income`, `transactions`, or `onboarding`. This records keyboard and pointer activations through the same link handler.

`financial_health_update_completed` uses only `destination` (`financial_health`, `loans`, or `income`) and a coarse `outcome`. Financial Health outcomes are `snapshot_saved` or `emergency_fund_saved`; loan and income outcomes are `created` or `updated`.

The transaction funnel reuses `expense_save_succeeded`. Its coarse `operation` dimension is `create`, `edit`, or `import`; `emi_choice_required` remains a boolean describing whether quick-add required EMI guidance. Edit is recorded only after the update succeeds, and import is recorded only after at least one transaction is persisted. Duplicate-only or failed imports do not complete the funnel. The onboarding funnel reuses `first_projection_saved`; its dimensions describe the numbered setup step and coarse flow state.

Scores, action copy, financial amounts, identifiers, category names, notes, and other personal data are not sent by these events.

### Useful Financial Health action funnels

1. `financial_health_action_opened` with `destination: financial_health` → `financial_health_update_completed` with `destination: financial_health`
2. `financial_health_action_opened` with `destination: loans` → `financial_health_update_completed` with `destination: loans`
3. `financial_health_action_opened` with `destination: income` → `financial_health_update_completed` with `destination: income`
4. `financial_health_action_opened` with `destination: transactions` → `expense_save_succeeded`, broken down by `operation`
5. `financial_health_action_opened` with `destination: onboarding` → `first_projection_saved`

Compare the number of successful outcomes with action opens for the same destination. For transactions, compare `create`, `edit`, and `import` to learn which persisted action completed the guidance. Use only these coarse operation types; do not add financial values, merchants, categories, notes, identifiers, filenames, row contents, or user-provided labels to the funnel.

### Useful retirement funnels

1. `/retirement` page view → `retirement_lifestyle_previewed` → `retirement_plan_saved`
2. `/retirement` page view → `retirement_planner_opened` → `retirement_plan_saved` with `planner_used: yes`
3. `/retirement` page view → `retirement_lifestyle_previewed` → `retirement_planner_opened` → `retirement_plan_saved`

Compare save conversion by `lifestyle`, `planner_used`, `contribution_mode`, and `funding_status`. Break planner opens down by `pension_source_count` to see whether people with more complex plans use the detailed controls more often.
