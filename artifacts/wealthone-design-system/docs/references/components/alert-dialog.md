# Alert Dialog

- Source: `artifacts/wealthone-expenses/src/components/ui/alert-dialog.tsx`
- Usage evidence: 1 direct application import — `src/pages/transactions.tsx`.
- Dependencies: React, `@radix-ui/react-alert-dialog`, local `Button`, and `cn`.
- Public API: `AlertDialog`, `AlertDialogPortal`, `AlertDialogOverlay`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel`.
- Behavior: modal confirmation flow preserves Radix focus management and escape/overlay semantics, with destructive-friendly cancel/action controls.
- Story: `src/preview/demos/alert-dialog.tsx`