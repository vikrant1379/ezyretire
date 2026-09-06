# Date picker input

- Source: `artifacts/wealthone-expenses/src/components/ui/date-picker-input.tsx`
- Usage evidence: `src/components/quick-add-expense.tsx`, `src/components/edit-expense-dialog.tsx`, `src/pages/onboarding.tsx`, `src/pages/loans.tsx`, and profile form fields use `DatePickerInput` for bounded dates.
- Dependencies: `date-fns`, Lucide Calendar/X icons, `Input`, `Button`, `Calendar`, `Popover`, and `cn`.
- Public API: `DatePickerInput({ value?, onChange, minDate?, maxDate?, optional?, className?, placeholder?, id?, showTodayShortcut? })`.
- Behavior: accepts `DD/MM/YYYY`, `D/M/YYYY`, and ISO date text; commits only valid local dates, enforces inclusive bounds, reports accessible inline errors, and syncs external values when closed. Invalid drafts do not erase a controlled value; leaving an invalid edit restores the prior committed date when one exists. Required dates cannot be cleared, while optional dates expose an explicit clear action. The popover calendar supports bounded selection and an optionally displayed Today shortcut.
- Story path: `src/preview/demos/date-picker-input.tsx` (`DatePickerInputDemo`).