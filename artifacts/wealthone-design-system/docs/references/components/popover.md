# Popover

- Source: `artifacts/wealthone-expenses/src/components/ui/popover.tsx`
- Usage evidence: `src/pages/loans.tsx`, `src/components/edit-expense-dialog.tsx`, and the date picker use popover roots, triggers, and content.
- Dependencies: Radix Popover and `cn`.
- Public API: `Popover`, `PopoverTrigger`, `PopoverAnchor`, and `PopoverContent`.
- Behavior: retains Radix focus and dismissal behavior. Content portals above the page, defaults to centered alignment with a 4px offset, and animates by open state and side.
- Story path: `src/preview/demos/popover.tsx` (`PopoverDemo`).