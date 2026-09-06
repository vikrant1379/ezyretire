# Calendar

- Source: `artifacts/wealthone-expenses/src/components/ui/calendar.tsx`
- Usage evidence: `src/components/ui/date-picker-input.tsx` renders the calendar in single-selection, bounded dropdown-caption mode for date fields.
- Dependencies: React Day Picker, Lucide chevrons, `Button`, `buttonVariants`, and `cn`.
- Public API: `Calendar` accepts all `DayPicker` props plus `buttonVariant`; `CalendarDayButton` is also exported.
- Behavior: supports React Day Picker selection modes and custom formatters/components, with source-specific dropdown captions, responsive calendar layout, selected/range/today states, disabled dates, and focus restoration for day buttons.
- Story path: `src/preview/demos/calendar.tsx` (`CalendarDemo`).