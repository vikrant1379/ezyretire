# Form

- Source: `artifacts/wealthone-expenses/src/components/ui/form.tsx`
- Usage evidence: React Hook Form compositions in `src/pages/advice.tsx`, `src/pages/onboarding.tsx`, `src/pages/income.tsx`, and `src/pages/investments.tsx`.
- Dependencies: React Hook Form, Radix Label, Radix Slot, `Label`, and `cn`.
- Public API: `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, and `useFormField`.
- Behavior: scopes controller field names and generated item IDs through context; wires labels, descriptions, messages, `aria-describedby`, and `aria-invalid`; displays controller errors ahead of custom message children.
- Story path: `src/preview/demos/form.tsx` (`FormDemo`).