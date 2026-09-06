# Migrating web UI to ezyRetire Design System

Read `artifacts/wealthone-design-system/docs/AGENTS.md` and
`artifacts/wealthone-design-system/docs/consuming-web.md` first. Use this guide
when a web app, including a fresh scaffold, already has local theme or component
copies.

## Replace the local theme

Replace the app's Tailwind/theme setup with the package import from the web
consumption guide.

- Remove the app's own `@import "tailwindcss"`, plugin imports, and generated
  `:root` / `.dark` token definitions.
- Keep app-specific CSS that is not a theme or package-provided primitive.
- Keep Tailwind v3 directives and configure its package component source as
  described in the web consumption guide.

## Rewrite imports

Rewrite every local import for a module this package provides:

- `@/components/ui/<name>` →
  `@workspace/wealthone-design-system/components/ui/<name>`
- `@/lib/utils` (`cn`) → `@workspace/wealthone-design-system/lib/utils`
- `@/hooks/use-toast` → `@workspace/wealthone-design-system/hooks/use-toast`

Judge component ownership by the imported module, not by the file doing the
import. App-specific components may remain local, but they must import shared
primitives from this package.

## Delete superseded files

- Delete package-provided files from the app's `src/components/ui/`; remove the
  directory if it becomes empty.
- Delete local `src/lib/utils.ts` when it only provided `cn`.
- Delete local `src/hooks/use-toast.ts` after every caller uses the package hook.
- Remove dependencies used only by the deleted local component library when the
  design-system package already supplies them transitively.

## Verify migration

Grep for `@/components/ui/`, `@/lib/utils`, and `@/hooks/use-toast`. Every
remaining match must refer to an app-specific module or export the package does
not provide. Run typecheck and the dev server after deleting local copies.

Migration is complete when no package-provided component, `cn`, toast hook, or
theme token block remains local.

Before deleting local UI files, compare them with
`docs/references/component-inventory.md`. Every source family is now implemented,
including Date Picker Input and the shared Toast/Toaster family, so consumers
should not retain duplicate primitive copies.
