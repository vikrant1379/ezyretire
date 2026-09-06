# Checkbox

- Source paths: `artifacts/wealthone-expenses/src/components/ui/checkbox.tsx`; catalog implementation: `artifacts/wealthone-design-system/src/components/ui/checkbox.tsx`
- Usage evidence: `src/pages/advice.tsx` uses a controlled consent checkbox; `src/pages/admin-advice.tsx`, `src/components/edit-expense-dialog.tsx`, and `src/components/quick-add-expense.tsx` use it for boolean form fields.
- Dependencies: React, `@radix-ui/react-checkbox`, `lucide-react` (`Check`), and the local `cn` utility.
- Public API: `Checkbox`, forwarding the Radix Checkbox Root ref and props, including `checked`, `defaultChecked`, `onCheckedChange`, `disabled`, `required`, `name`, `value`, and `id`.
- Behavior: a 16px peer checkbox with checked primary fill and foreground check indicator. It retains Radix controlled/uncontrolled state, keyboard interaction, form semantics, focus ring, and disabled state.
- Story path: `artifacts/wealthone-design-system/src/preview/demos/checkbox.tsx` demonstrates checked, unchecked, and disabled states with associated labels.