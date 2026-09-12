import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/wealthone-design-system/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/wealthone-design-system/components/ui/popover";

export function FinanceTermHelp({
  term,
  summary,
  details,
  example,
}: {
  term: string;
  summary: string;
  details: string;
  example?: string;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`What does ${term} mean?`}
            data-testid={`button-term-help-${term.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <CircleHelp className="h-4 w-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
          <p className="font-semibold">{term}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{summary}</p>
          <Button type="button" variant="link" className="mt-2 h-auto p-0" onClick={() => setDetailsOpen(true)} data-testid={`button-learn-${term.toLowerCase().replace(/\s+/g, "-")}`}>
            Learn with an example
          </Button>
        </PopoverContent>
      </Popover>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{term}</DialogTitle>
            <DialogDescription>{summary}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm leading-6">
            <p>{details}</p>
            {example && <div className="rounded-lg border bg-muted/40 p-4"><strong>Example:</strong> {example}</div>}
            <p className="text-xs text-muted-foreground">This explanation is educational and is not financial advice.</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}