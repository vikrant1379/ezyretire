import { MessageCircle } from "lucide-react";
import { useGetWhatsAppSupport } from "@workspace/api-client-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/wealthone-design-system/components/ui/popover";
import { cn } from "@workspace/wealthone-design-system/lib/utils";

export function WhatsAppSupport({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useGetWhatsAppSupport();

  if (isLoading) return null;

  const available = data?.available && data.whatsappUrl;
  if (!available) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? "icon" : "default"}
          className={cn(
            compact ? "text-muted-foreground" : "w-full justify-start text-muted-foreground",
            className,
          )}
          aria-label="WhatsApp support"
          data-testid={compact ? "button-whatsapp-support-mobile" : "button-whatsapp-support-desktop"}
        >
          <MessageCircle className={cn("h-4 w-4", !compact && "mr-3")} />
          {!compact && "WhatsApp support"}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={compact ? "end" : "start"}
        side={compact ? "bottom" : "right"}
        className="w-72 space-y-3"
        data-testid="whatsapp-support-popover"
      >
        <div>
          <p className="font-medium text-foreground">WhatsApp support</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your conversation will open and continue privately in WhatsApp.
          </p>
        </div>
        <Button asChild className="w-full bg-support text-support-foreground hover:bg-support-hover">
            <a
              href={data.whatsappUrl!}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-open-whatsapp-support"
            >
              <MessageCircle className="mr-2 h-4 w-4" />
              Continue in WhatsApp
            </a>
        </Button>
      </PopoverContent>
    </Popover>
  );
}