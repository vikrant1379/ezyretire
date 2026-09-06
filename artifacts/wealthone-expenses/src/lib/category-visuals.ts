import {
  Car,
  Clapperboard,
  GraduationCap,
  HeartPulse,
  House,
  Plane,
  Shapes,
  ShoppingBag,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Categories differ by glyph, not by colour. Every icon uses the theme's
 * primary tint, matching the list avatars on Investments, Income and the
 * dashboard's recent transactions.
 */
export const CATEGORY_ICON_TONE = "bg-primary/10 text-primary";

const MISCELLANEOUS: LucideIcon = Shapes;

const BY_CATEGORY: Record<string, LucideIcon> = {
  "food & dining": UtensilsCrossed,
  transportation: Car,
  shopping: ShoppingBag,
  entertainment: Clapperboard,
  housing: House,
  utilities: Zap,
  "health & wellness": HeartPulse,
  travel: Plane,
  education: GraduationCap,
  miscellaneous: MISCELLANEOUS,
};

/**
 * Imported statements bring in category names we never defined, so anything
 * unrecognised is matched on the words it contains before giving up.
 */
const BY_KEYWORD: Array<[RegExp, LucideIcon]> = [
  [/groc|food|dining|restaurant|cafe|coffee|swiggy|zomato|meal/, UtensilsCrossed],
  [/flight|hotel|trip|vacation|holiday|travel/, Plane],
  [/transport|fuel|petrol|diesel|cab|taxi|uber|ola|metro|bus|train|parking|car/, Car],
  [/rent|hous|home|apartment|maintenance|property/, House],
  [/electric|water|gas|internet|broadband|mobile|recharge|bill|utility|utilities/, Zap],
  [/health|medical|doctor|hospital|pharmac|medicine|gym|fitness|wellness|insurance/, HeartPulse],
  [/school|college|tuition|course|educat|book|study|fees/, GraduationCap],
  [/shop|cloth|apparel|amazon|flipkart|myntra|electronics|gift/, ShoppingBag],
  [/movie|cinema|game|entertain|subscription|netflix|spotify|music|sport/, Clapperboard],
];

export function getCategoryIcon(category: string): LucideIcon {
  const normalized = category.trim().toLowerCase();
  const exact = BY_CATEGORY[normalized];
  if (exact) return exact;

  for (const [pattern, icon] of BY_KEYWORD) {
    if (pattern.test(normalized)) return icon;
  }

  return MISCELLANEOUS;
}
