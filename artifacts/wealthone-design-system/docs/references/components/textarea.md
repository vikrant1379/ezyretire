# Textarea

- Source: `artifacts/wealthone-expenses/src/components/ui/textarea.tsx`
- Usage evidence: `src/pages/advice.tsx`, `src/pages/income.tsx`, and expense and investment editing flows use `Textarea` through form controls.
- Dependencies: React and `cn`.
- Public API: `Textarea`, forwarding native textarea props and its ref.
- Behavior: provides a full-width, 60px-minimum multiline field with placeholder, focus-ring, and disabled states while retaining all native textarea behavior.
- Story path: `src/preview/demos/textarea.tsx` (`TextareaDemo`).