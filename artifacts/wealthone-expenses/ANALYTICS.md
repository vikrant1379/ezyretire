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