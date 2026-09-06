import { ArrowDownWideNarrow, ArrowUpDown, ArrowUpNarrowWide } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/wealthone-design-system/components/ui/select";
import type { SortDirection } from "@/lib/card-order";
import { cn } from "@/lib/utils";

export function CardSortControls<By extends string>({
  value,
  direction,
  options,
  onByChange,
  onDirectionChange,
  compactOnMobile = false,
  className,
}: {
  value: By;
  direction: SortDirection;
  options: { value: By; label: string }[];
  onByChange: (value: By) => void;
  onDirectionChange: (direction: SortDirection) => void;
  compactOnMobile?: boolean;
  className?: string;
}) {
  const metricSort = value !== "manual";

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2",
        compactOnMobile &&
          "gap-0.5 rounded-lg border border-border/40 bg-muted/20 p-0.5 shadow-none sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0",
        className,
      )}
    >
      <span className="hidden items-center gap-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
        <ArrowUpDown className="h-3.5 w-3.5" />
        Sort by
      </span>
      <Select value={value} onValueChange={(next) => onByChange(next as By)}>
        <SelectTrigger
          className={cn(
            "h-8 w-46",
            compactOnMobile &&
              "w-max min-w-0 border-0 bg-transparent px-2 shadow-none focus:ring-1 focus:ring-primary/20 sm:w-46 sm:border sm:bg-background sm:px-3",
          )}
          aria-label="Sort cards by"
        >
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {metricSort ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn("h-8 w-8", compactOnMobile && "border-0 bg-transparent shadow-none sm:border")}
          title={direction === "desc" ? "Highest first" : "Lowest first"}
          aria-label={direction === "desc" ? "Sorted highest first" : "Sorted lowest first"}
          onClick={() => onDirectionChange(direction === "desc" ? "asc" : "desc")}
        >
          {direction === "desc" ? (
            <ArrowDownWideNarrow className="h-4 w-4" />
          ) : (
            <ArrowUpNarrowWide className="h-4 w-4" />
          )}
        </Button>
      ) : null}
    </div>
  );
}
