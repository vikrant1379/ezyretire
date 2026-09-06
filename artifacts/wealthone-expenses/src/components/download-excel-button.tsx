import { Download, MoreVertical } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@workspace/wealthone-design-system/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/wealthone-design-system/components/ui/alert-dialog";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import {
  downloadExcelWorkbook,
  type ExcelSheet,
} from "@/lib/excel-export";

type DownloadExcelButtonProps = {
  sheets: readonly ExcelSheet<any>[];
  reportSlug: string;
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
  mobileOverflow?: boolean;
  mobileDirectDownload?: boolean;
  confirmBeforeDownload?: boolean;
  mobileTriggerClassName?: string;
};

export function DownloadExcelButton({
  sheets,
  reportSlug,
  className,
  size = "default",
  mobileOverflow = true,
  mobileDirectDownload = false,
  confirmBeforeDownload = false,
  mobileTriggerClassName,
}: DownloadExcelButtonProps) {
  const { toast } = useToast();
  const hasRows = sheets.some((sheet) => sheet.rows.length > 0);
  const label = hasRows ? "Download report" : "No rows available to download";

  const handleDownload = () => {
    try {
      downloadExcelWorkbook(sheets, reportSlug);
    } catch {
      toast({
        title: "Excel download failed",
        description: "We couldn't create the workbook. Please try again.",
        variant: "destructive",
      });
    }
  };

  const confirmationDialog = (
    <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md rounded-xl">
      <AlertDialogHeader>
        <AlertDialogTitle>Download income report?</AlertDialogTitle>
        <AlertDialogDescription>
          We’ll create an Excel workbook using your current income-source data.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:flex">
        <AlertDialogCancel className="mt-0">Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={handleDownload}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          Download
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );

  const downloadButton = (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={mobileOverflow ? cn("hidden sm:inline-flex", className) : className}
      disabled={!hasRows}
      aria-label={label}
      title={label}
      data-testid={`button-download-excel-${reportSlug}`}
      onClick={confirmBeforeDownload ? undefined : handleDownload}
    >
      <Download className="mr-2 h-4 w-4" aria-hidden="true" />
      Download report
    </Button>
  );

  if (mobileDirectDownload) {
    const mobileButton = (
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn("h-9 w-9 shrink-0 rounded-full sm:hidden", mobileTriggerClassName)}
        disabled={!hasRows}
        aria-label={label}
        title={label}
        data-testid={`button-download-excel-${reportSlug}-mobile`}
        onClick={confirmBeforeDownload ? undefined : handleDownload}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
      </Button>
    );

    if (!confirmBeforeDownload) {
      return (
        <>
          {mobileButton}
          {downloadButton}
        </>
      );
    }

    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>{mobileButton}</AlertDialogTrigger>
        <AlertDialogTrigger asChild>{downloadButton}</AlertDialogTrigger>
        {confirmationDialog}
      </AlertDialog>
    );
  }

  if (!mobileOverflow) {
    if (!confirmBeforeDownload) return downloadButton;
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>{downloadButton}</AlertDialogTrigger>
        {confirmationDialog}
      </AlertDialog>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn("h-9 w-9 shrink-0 rounded-full sm:hidden", mobileTriggerClassName)}
            disabled={!hasRows}
            aria-label="More report actions"
            title={label}
            data-testid={`button-more-report-actions-${reportSlug}`}
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            disabled={!hasRows}
            onSelect={handleDownload}
            data-testid={`menu-download-excel-${reportSlug}`}
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Download report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {downloadButton}
    </>
  );
}
