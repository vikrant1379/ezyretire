# Separator

- Source paths: `artifacts/wealthone-expenses/src/components/ui/separator.tsx`; catalog implementation: `artifacts/wealthone-design-system/src/components/ui/separator.tsx`
- Usage evidence: `src/components/ui/field.tsx` uses a horizontal separator behind optional field-group content; `src/components/ui/button-group.tsx` composes vertical separators between grouped controls. The source family is also consumed by menu and command component compositions.
- Dependencies: React, `@radix-ui/react-separator`, and the local `cn` utility.
- Public API: `Separator`, forwarding Radix Separator Root props. `orientation` defaults to `horizontal`; `decorative` defaults to `true`.
- Behavior: renders a shrink-safe `bg-border` rule, full-width and 1px high horizontally or full-height and 1px wide vertically. Radix preserves the semantic separator behavior when `decorative={false}`.
- Story path: `artifacts/wealthone-design-system/src/preview/demos/separator.tsx` demonstrates a horizontal content divider and vertical dividers in inline navigation.