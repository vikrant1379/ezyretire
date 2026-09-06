# Hover Card

- Source: `artifacts/wealthone-expenses/src/components/ui/hover-card.tsx`
- Usage evidence: 0 direct application imports (`rg "components/ui/hover-card" artifacts/wealthone-expenses/src`).
- Dependencies: React, `@radix-ui/react-hover-card`, and `cn`.
- Public API: `HoverCard`, `HoverCardTrigger`, `HoverCardContent` with Radix open-delay and positioning props.
- Behavior: non-modal hover/focus preview is portal-positioned and animated by side/state.
- Story: `src/preview/demos/hover-card.tsx`