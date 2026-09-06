# Sheet

- Source: `artifacts/wealthone-expenses/src/components/ui/sheet.tsx`
- Usage evidence: 0 direct application imports; source sibling dependency in `src/components/ui/sidebar.tsx`; catalog story: `src/preview/demos/sheet.tsx`.
- Dependencies: React, Radix Dialog, CVA, Lucide `X`, `cn`.
- Public API: `Sheet`, `SheetPortal`, `SheetOverlay`, `SheetTrigger`, `SheetClose`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`.
- Behavior: Uses Dialog accessibility and focus trapping for modal side panels; content supports `top`, `right`, `bottom`, and `left` animated sides.