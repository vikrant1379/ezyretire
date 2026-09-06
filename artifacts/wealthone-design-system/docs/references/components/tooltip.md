# Tooltip

- Source paths: `artifacts/wealthone-expenses/src/components/ui/tooltip.tsx`; catalog implementation: `artifacts/wealthone-design-system/src/components/ui/tooltip.tsx`
- Usage evidence: `src/App.tsx` provides the application-wide `TooltipProvider`. The source's tooltip family is available for composed consumer controls; chart files import Recharts' distinct `Tooltip` primitive rather than this UI component.
- Dependencies: React, `@radix-ui/react-tooltip`, and the local `cn` utility.
- Public API: `TooltipProvider`, `Tooltip`, `TooltipTrigger`, and `TooltipContent`. The provider/root/trigger retain Radix props; content forwards Radix Content props and defaults `sideOffset` to `4`.
- Behavior: content renders through a Radix portal with primary background, foreground text, positioning transform origin, and open/closed plus side-aware animations. Radix retains trigger accessibility, hover/focus behavior, collision-aware placement, and delay configuration.
- Story path: `artifacts/wealthone-design-system/src/preview/demos/tooltip.tsx` demonstrates provider, `asChild` trigger composition with an icon button, and default tooltip content.