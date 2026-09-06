# Label

- Source: `artifacts/wealthone-expenses/src/components/ui/label.tsx`
- Usage evidence: labels appear in `src/components/quick-add-expense.tsx`, `src/components/edit-expense-dialog.tsx`, and form pages including `src/pages/advice.tsx`.
- Dependencies: Radix Label, CVA, and `cn`.
- Public API: `Label`, forwarding Radix Label root props and `labelVariants` variant props.
- Behavior: preserves native/Radix label association and applies compact medium text with peer-disabled cursor and opacity states.
- Story path: no dedicated source story; representative usage is shown in `src/preview/demos/popover.tsx` and `src/preview/demos/form.tsx`.