import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { cn } from "@workspace/wealthone-design-system/lib/utils";

type QueryErrorStateProps = {
  title?: string;
  description?: string;
  onRetry: () => unknown | Promise<unknown>;
  className?: string;
  fullPage?: boolean;
};

export function QueryErrorState({
  title = "We couldn't load your financial data",
  description = "Your saved information is still safe. Check your connection and try again.",
  onRetry,
  className,
  fullPage = false,
}: QueryErrorStateProps) {
  const [isRetrying, setIsRetrying] = useState(false);

  const retry = async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center justify-center px-4 py-10",
        fullPage ? "min-h-[100dvh] bg-background" : "min-h-[50vh]",
        className,
      )}
    >
      <section className="w-full max-w-lg rounded-xl border border-warning/30 bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="mt-4 font-serif text-xl font-semibold text-foreground">{title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <Button className="mt-5" onClick={retry} disabled={isRetrying}>
          <RefreshCw className={cn("mr-2 h-4 w-4", isRetrying && "animate-spin")} />
          {isRetrying ? "Trying again..." : "Try again"}
        </Button>
      </section>
    </div>
  );
}