# Alert

- Source: `artifacts/wealthone-expenses/src/components/ui/alert.tsx`
- Usage evidence: 1 direct application import — `src/pages/transactions.tsx`.
- Dependencies: React, `class-variance-authority`, and `cn`.
- Public API: `Alert`, `AlertTitle`, `AlertDescription`; `Alert` supports `default` and `destructive` variants plus native div props.
- Behavior: semantic alert container styles nested SVGs, title, and description by variant.
- Story: `src/preview/demos/alert.tsx`