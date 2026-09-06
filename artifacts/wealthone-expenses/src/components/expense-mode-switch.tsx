import { Link, useLocation } from "wouter";
import { Receipt, SlidersHorizontal } from "lucide-react";
import { cn } from "@workspace/wealthone-design-system/lib/utils";

const modes = [
  { path: "/transactions", label: "Transactions", icon: Receipt },
  { path: "/budgets", label: "Budget settings", icon: SlidersHorizontal },
];

export function ExpenseModeSwitch() {
  const [location] = useLocation();

  return (
    <nav
      aria-label="Expenses views"
      className="grid w-full grid-cols-2 rounded-xl bg-muted p-1 sm:w-fit sm:min-w-80"
    >
      {modes.map((mode) => {
        const Icon = mode.icon;
        const isActive = location === mode.path;

        return (
          <Link key={mode.path} href={mode.path}>
            <div
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                isActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{mode.label}</span>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}