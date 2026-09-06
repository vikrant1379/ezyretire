import { lazy, type ComponentType } from 'react';
import { ColorsPage, FontsPage, LayoutPage, OverviewPage } from './foundations';

function lazyPage(load: () => Promise<ComponentType>) {
  return lazy(async () => ({ default: await load() }));
}

const AccordionDemo = lazyPage(() => import('./demos/accordion').then(({ AccordionDemo }) => AccordionDemo));
const AlertDialogDemo = lazyPage(() => import('./demos/alert-dialog').then(({ AlertDialogDemo }) => AlertDialogDemo));
const AlertDemo = lazyPage(() => import('./demos/alert').then(({ AlertDemo }) => AlertDemo));
const AspectRatioDemo = lazyPage(() => import('./demos/aspect-ratio').then(({ AspectRatioDemo }) => AspectRatioDemo));
const AvatarDemo = lazyPage(() => import('./demos/avatar').then(({ AvatarDemo }) => AvatarDemo));
const BadgeDemo = lazyPage(() => import('./demos/badge').then(({ BadgeDemo }) => BadgeDemo));
const BreadcrumbDemo = lazyPage(() => import('./demos/breadcrumb').then(({ BreadcrumbDemo }) => BreadcrumbDemo));
const ButtonGroupDemo = lazyPage(() => import('./demos/button-group').then(({ ButtonGroupDemo }) => ButtonGroupDemo));
const ButtonDemo = lazyPage(() => import('./demos/button').then(({ ButtonDemo }) => ButtonDemo));
const CalendarDemo = lazyPage(() => import('./demos/calendar').then(({ CalendarDemo }) => CalendarDemo));
const CardDemo = lazyPage(() => import('./demos/card').then(({ CardDemo }) => CardDemo));
const CarouselDemo = lazyPage(() => import('./demos/carousel').then(({ CarouselDemo }) => CarouselDemo));
const ChartDemo = lazyPage(() => import('./demos/chart').then(({ ChartDemo }) => ChartDemo));
const CheckboxDemo = lazyPage(() => import('./demos/checkbox').then(({ CheckboxDemo }) => CheckboxDemo));
const CollapsibleDemo = lazyPage(() => import('./demos/collapsible').then(({ CollapsibleDemo }) => CollapsibleDemo));
const CommandDemo = lazyPage(() => import('./demos/command').then(({ CommandDemo }) => CommandDemo));
const ContextMenuDemo = lazyPage(() => import('./demos/context-menu').then(({ ContextMenuDemo }) => ContextMenuDemo));
const DatePickerInputDemo = lazyPage(() => import('./demos/date-picker-input').then(({ DatePickerInputDemo }) => DatePickerInputDemo));
const DialogDemo = lazyPage(() => import('./demos/dialog').then(({ DialogDemo }) => DialogDemo));
const DrawerDemo = lazyPage(() => import('./demos/drawer').then(({ DrawerDemo }) => DrawerDemo));
const DropdownMenuDemo = lazyPage(() => import('./demos/dropdown-menu').then(({ DropdownMenuDemo }) => DropdownMenuDemo));
const EmptyDemo = lazyPage(() => import('./demos/empty').then(({ EmptyDemo }) => EmptyDemo));
const FieldDemo = lazyPage(() => import('./demos/field').then(({ FieldDemo }) => FieldDemo));
const FormDemo = lazyPage(() => import('./demos/form').then(({ FormDemo }) => FormDemo));
const HoverCardDemo = lazyPage(() => import('./demos/hover-card').then(({ HoverCardDemo }) => HoverCardDemo));
const InputGroupDemo = lazyPage(() => import('./demos/input-group').then(({ InputGroupDemo }) => InputGroupDemo));
const InputOtpDemo = lazyPage(() => import('./demos/input-otp').then(({ InputOtpDemo }) => InputOtpDemo));
const InputDemo = lazyPage(() => import('./demos/input').then(({ InputDemo }) => InputDemo));
const ItemDemo = lazyPage(() => import('./demos/item').then(({ ItemDemo }) => ItemDemo));
const KbdDemo = lazyPage(() => import('./demos/kbd').then(({ KbdDemo }) => KbdDemo));
const LabelDemo = lazyPage(() => import('./demos/label').then(({ LabelDemo }) => LabelDemo));
const MenubarDemo = lazyPage(() => import('./demos/menubar').then(({ MenubarDemo }) => MenubarDemo));
const NavigationMenuDemo = lazyPage(() => import('./demos/navigation-menu').then(({ NavigationMenuDemo }) => NavigationMenuDemo));
const PaginationDemo = lazyPage(() => import('./demos/pagination').then(({ PaginationDemo }) => PaginationDemo));
const PopoverDemo = lazyPage(() => import('./demos/popover').then(({ PopoverDemo }) => PopoverDemo));
const ProgressDemo = lazyPage(() => import('./demos/progress').then(({ ProgressDemo }) => ProgressDemo));
const RadioGroupDemo = lazyPage(() => import('./demos/radio-group').then(({ RadioGroupDemo }) => RadioGroupDemo));
const ResizableDemo = lazyPage(() => import('./demos/resizable').then(({ ResizableDemo }) => ResizableDemo));
const ScrollAreaDemo = lazyPage(() => import('./demos/scroll-area').then(({ ScrollAreaDemo }) => ScrollAreaDemo));
const SelectDemo = lazyPage(() => import('./demos/select').then(({ SelectDemo }) => SelectDemo));
const SeparatorDemo = lazyPage(() => import('./demos/separator').then(({ SeparatorDemo }) => SeparatorDemo));
const SheetDemo = lazyPage(() => import('./demos/sheet').then(({ SheetDemo }) => SheetDemo));
const SidebarDemo = lazyPage(() => import('./demos/sidebar').then(({ SidebarDemo }) => SidebarDemo));
const SkeletonDemo = lazyPage(() => import('./demos/skeleton').then(({ SkeletonDemo }) => SkeletonDemo));
const SliderDemo = lazyPage(() => import('./demos/slider').then(({ SliderDemo }) => SliderDemo));
const SonnerDemo = lazyPage(() => import('./demos/sonner').then(({ SonnerDemo }) => SonnerDemo));
const SpinnerDemo = lazyPage(() => import('./demos/spinner').then(({ SpinnerDemo }) => SpinnerDemo));
const SwitchDemo = lazyPage(() => import('./demos/switch').then(({ SwitchDemo }) => SwitchDemo));
const TableDemo = lazyPage(() => import('./demos/table').then(({ TableDemo }) => TableDemo));
const TabsDemo = lazyPage(() => import('./demos/tabs').then(({ TabsDemo }) => TabsDemo));
const TextareaDemo = lazyPage(() => import('./demos/textarea').then(({ TextareaDemo }) => TextareaDemo));
const ToastDemo = lazyPage(() => import('./demos/toast').then(({ ToastDemo }) => ToastDemo));
const ToggleGroupDemo = lazyPage(() => import('./demos/toggle-group').then(({ ToggleGroupDemo }) => ToggleGroupDemo));
const ToggleDemo = lazyPage(() => import('./demos/toggle').then(({ ToggleDemo }) => ToggleDemo));
const TooltipDemo = lazyPage(() => import('./demos/tooltip').then(({ TooltipDemo }) => TooltipDemo));

export type PreviewEntry = {
  id: string;
  name: string;
  description: string;
  Page: ComponentType;
};

export type NavGroup = {
  name: string;
  entries: PreviewEntry[];
};

export const DESIGN_SYSTEM = {
  title: 'ezyRetire Design System',
  description: 'Calm, trustworthy financial UI with warm surfaces, deep indigo actions, and clear Indian-money inputs.',
} as const;

export const OVERVIEW_ENTRY: PreviewEntry = {
  id: 'overview',
  name: 'Overview',
  description: 'ezyRetire foundations and the complete source-backed component catalog.',
  Page: OverviewPage,
};

export const NAV_GROUPS: NavGroup[] = [
  {
    name: 'Colors',
    entries: [{ id: 'color-roles', name: 'Color roles', description: 'Brand, semantic, surface, and chart colors.', Page: ColorsPage }],
  },
  {
    name: 'Fonts',
    entries: [{ id: 'type-scale', name: 'Type scale', description: 'Fraunces headings with Plus Jakarta Sans UI text.', Page: FontsPage }],
  },
  {
    name: 'Layout',
    entries: [{ id: 'spacing-radius', name: 'Spacing and radius', description: 'Four-pixel spacing rhythm and soft 12px corners.', Page: LayoutPage }],
  },
  {
    name: 'Actions',
    entries: [
      { id: 'button', name: 'Buttons', description: 'Primary, secondary, outline, ghost, link, and destructive actions.', Page: ButtonDemo },
      { id: 'button-group', name: 'Button group', description: 'Connected actions with shared orientation and separators.', Page: ButtonGroupDemo },
      { id: 'toggle', name: 'Toggle', description: 'Two-state pressed controls.', Page: ToggleDemo },
      { id: 'toggle-group', name: 'Toggle group', description: 'Single- and multi-select toggle collections.', Page: ToggleGroupDemo },
    ],
  },
  {
    name: 'Forms & inputs',
    entries: [
      { id: 'calendar', name: 'Calendar', description: 'Single-date, range, and dropdown date selection.', Page: CalendarDemo },
      { id: 'checkbox', name: 'Checkbox', description: 'Binary and indeterminate selection.', Page: CheckboxDemo },
      { id: 'date-picker-input', name: 'Date picker input', description: 'Typed DD/MM/YYYY entry with calendar, limits, and optional clearing.', Page: DatePickerInputDemo },
      { id: 'field', name: 'Field', description: 'Labels, descriptions, errors, and grouped controls.', Page: FieldDemo },
      { id: 'form', name: 'Form', description: 'React Hook Form integration and accessible validation.', Page: FormDemo },
      { id: 'input', name: 'Input', description: 'Text, number, and Indian-number-grouped entry.', Page: InputDemo },
      { id: 'input-group', name: 'Input group', description: 'Inputs with prefixes, suffixes, and actions.', Page: InputGroupDemo },
      { id: 'input-otp', name: 'Input OTP', description: 'Segmented one-time code entry.', Page: InputOtpDemo },
      { id: 'label', name: 'Label', description: 'Accessible control labels and disabled states.', Page: LabelDemo },
      { id: 'radio-group', name: 'Radio group', description: 'Exclusive option selection.', Page: RadioGroupDemo },
      { id: 'select', name: 'Select', description: 'Accessible single-choice selection.', Page: SelectDemo },
      { id: 'slider', name: 'Slider', description: 'Single-value and range input.', Page: SliderDemo },
      { id: 'switch', name: 'Switch', description: 'Immediate on/off settings.', Page: SwitchDemo },
      { id: 'textarea', name: 'Textarea', description: 'Multi-line text entry.', Page: TextareaDemo },
    ],
  },
  {
    name: 'Overlays',
    entries: [
      { id: 'alert-dialog', name: 'Alert dialog', description: 'Confirmation for consequential actions.', Page: AlertDialogDemo },
      { id: 'command', name: 'Command', description: 'Searchable command and option palette.', Page: CommandDemo },
      { id: 'context-menu', name: 'Context menu', description: 'Pointer-triggered contextual actions.', Page: ContextMenuDemo },
      { id: 'dialog', name: 'Dialog', description: 'Focused modal tasks and confirmations.', Page: DialogDemo },
      { id: 'drawer', name: 'Drawer', description: 'Touch-friendly edge panel.', Page: DrawerDemo },
      { id: 'dropdown-menu', name: 'Dropdown menu', description: 'Compact action and selection menus.', Page: DropdownMenuDemo },
      { id: 'hover-card', name: 'Hover card', description: 'Supplementary pointer and focus details.', Page: HoverCardDemo },
      { id: 'menubar', name: 'Menubar', description: 'Application-style menu groups.', Page: MenubarDemo },
      { id: 'popover', name: 'Popover', description: 'Anchored interactive content.', Page: PopoverDemo },
      { id: 'sheet', name: 'Sheet', description: 'Responsive side-panel tasks.', Page: SheetDemo },
      { id: 'tooltip', name: 'Tooltip', description: 'Concise hover and focus guidance.', Page: TooltipDemo },
    ],
  },
  {
    name: 'Menus & navigation',
    entries: [
      { id: 'breadcrumb', name: 'Breadcrumb', description: 'Hierarchical location and backtracking.', Page: BreadcrumbDemo },
      { id: 'navigation-menu', name: 'Navigation menu', description: 'Primary grouped navigation.', Page: NavigationMenuDemo },
      { id: 'pagination', name: 'Pagination', description: 'Paged data navigation.', Page: PaginationDemo },
      { id: 'sidebar', name: 'Sidebar', description: 'Responsive application navigation shell.', Page: SidebarDemo },
      { id: 'tabs', name: 'Tabs', description: 'Related views in one context.', Page: TabsDemo },
    ],
  },
  {
    name: 'Data display',
    entries: [
      { id: 'accordion', name: 'Accordion', description: 'Progressively disclosed content sections.', Page: AccordionDemo },
      { id: 'aspect-ratio', name: 'Aspect ratio', description: 'Media with stable proportions.', Page: AspectRatioDemo },
      { id: 'avatar', name: 'Avatar', description: 'Profile imagery with fallback initials.', Page: AvatarDemo },
      { id: 'badge', name: 'Badge', description: 'Compact status and category labels.', Page: BadgeDemo },
      { id: 'card', name: 'Card', description: 'Financial summaries, milestones, and grouped content.', Page: CardDemo },
      { id: 'carousel', name: 'Carousel', description: 'Sequential content panels.', Page: CarouselDemo },
      { id: 'chart', name: 'Chart', description: 'Token-aware Recharts wrappers, legends, and tooltips.', Page: ChartDemo },
      { id: 'collapsible', name: 'Collapsible', description: 'Expandable supporting information.', Page: CollapsibleDemo },
      { id: 'item', name: 'Item', description: 'Structured list and action rows.', Page: ItemDemo },
      { id: 'kbd', name: 'Keyboard key', description: 'Keyboard shortcut notation.', Page: KbdDemo },
      { id: 'scroll-area', name: 'Scroll area', description: 'Styled bounded overflow.', Page: ScrollAreaDemo },
      { id: 'separator', name: 'Separator', description: 'Visual grouping and hierarchy.', Page: SeparatorDemo },
      { id: 'table', name: 'Table', description: 'Structured financial and administrative data.', Page: TableDemo },
    ],
  },
  {
    name: 'Feedback',
    entries: [
      { id: 'alert', name: 'Alert', description: 'Inline informational and destructive messages.', Page: AlertDemo },
      { id: 'empty', name: 'Empty state', description: 'Clear next steps when content is absent.', Page: EmptyDemo },
      { id: 'progress', name: 'Progress', description: 'Task and goal completion.', Page: ProgressDemo },
      { id: 'skeleton', name: 'Skeleton', description: 'Layout-preserving loading placeholders.', Page: SkeletonDemo },
      { id: 'sonner', name: 'Sonner', description: 'Lightweight transient notifications.', Page: SonnerDemo },
      { id: 'spinner', name: 'Spinner', description: 'Compact indeterminate activity.', Page: SpinnerDemo },
      { id: 'toast', name: 'Toast', description: 'Actionable notifications with provider and hook.', Page: ToastDemo },
    ],
  },
  {
    name: 'Structure',
    entries: [
      { id: 'resizable', name: 'Resizable panels', description: 'Adjustable split layouts.', Page: ResizableDemo },
    ],
  },
];

export const ALL_ENTRIES: PreviewEntry[] = [OVERVIEW_ENTRY, ...NAV_GROUPS.flatMap((group) => group.entries)];

const duplicateIds = ALL_ENTRIES.map((entry) => entry.id).filter((id, index, ids) => ids.indexOf(id) !== index);
if (duplicateIds.length > 0) throw new Error(`Duplicate preview page id(s): ${[...new Set(duplicateIds)].join(', ')}`);