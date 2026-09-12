import React, { useState, useRef, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { useImportExpenses } from "@/hooks/use-expenses";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { Download, Upload, Info, MoreVertical } from "lucide-react";
import {
  getLinkedLoanName,
  matchLoanByName,
  type Loan,
  type Expense,
} from "@/lib/storage";
import { DownloadExcelButton } from "@/components/download-excel-button";
import {
  buildCompleteFinancialPlanSheets,
  buildTransactionReportSheets,
} from "@/lib/excel-report-builders";
import { downloadExcelWorkbook } from "@/lib/excel-export";
import {
  parseImportedExpenseDate,
  type ImportedExpense,
} from "@/lib/expense-import";
import { fetchFinancialData, restoreFinancialData } from "@/lib/financial-api";
import { parseFinancialBackup, serializeFinancialBackup } from "@/lib/financial-backup";
import { useFinancialOperation } from "@/hooks/use-financial-write";
import { isFinancialAccountSwitchError } from "@/lib/financial-api";
import type { FinancialData } from "@/lib/financial-api";
import { trackEvent } from "@/lib/analytics";
import { trackExpenseSaveSucceeded } from "@/lib/expense-analytics";
import { BankStatementImport } from "@/components/bank-statement-import";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/wealthone-design-system/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/wealthone-design-system/components/ui/dropdown-menu";

type DataManagerProps = {
  loans?: Loan[];
  expenses: Expense[];
};

type ExpenseImportResult = {
  added: unknown[];
  duplicateCount: number;
};

type ExpenseImportMutationCallbacksDependencies = {
  trackSuccess?: typeof trackExpenseSaveSucceeded;
  onSuccess: (result: ExpenseImportResult) => void;
  onError: () => void;
};

export function createExpenseImportMutationCallbacks({
  trackSuccess = trackExpenseSaveSucceeded,
  onSuccess,
  onError,
}: ExpenseImportMutationCallbacksDependencies) {
  return {
    onSuccess: (result: ExpenseImportResult) => {
      if (result.added.length > 0) {
        trackSuccess("import");
      }
      onSuccess(result);
    },
    onError,
  };
}

type CompletePlanDownloadButtonProps = {
  exporting: boolean;
  onDownload: () => void;
  mobile?: boolean;
};

export function CompletePlanDownloadButton({
  exporting,
  onDownload,
  mobile = false,
}: CompletePlanDownloadButtonProps): ReactNode {
  return (
    <Button
      type="button"
      variant={mobile ? "ghost" : "outline"}
      className={mobile ? "w-full justify-start" : undefined}
      onClick={onDownload}
      disabled={exporting}
    >
      <Download className="h-4 w-4 mr-2" />
      {exporting ? "Preparing plan..." : "Download complete plan"}
    </Button>
  );
}

type BackupDownloadButtonProps = {
  exporting: boolean;
  onDownload: () => void;
  mobile?: boolean;
};

export function BackupDownloadButton({
  exporting,
  onDownload,
  mobile = false,
}: BackupDownloadButtonProps): ReactNode {
  return (
    <Button
      type="button"
      variant={mobile ? "ghost" : "outline"}
      className={mobile ? "w-full justify-start" : undefined}
      onClick={onDownload}
      disabled={exporting}
    >
      <Download className="h-4 w-4 mr-2" />
      {exporting ? "Preparing backup..." : "Export backup"}
    </Button>
  );
}

type BackupDownloadDependencies = {
  fetchData: () => Promise<FinancialData>;
  serialize: typeof serializeFinancialBackup;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  createLink: () => Pick<HTMLAnchorElement, "href" | "download" | "click">;
  getDate: () => Date;
  showError: () => void;
  onSuccess?: () => void;
};

export async function runBackupDownload(
  inProgress: { current: boolean },
  setExporting: (exporting: boolean) => void,
  {
    fetchData,
    serialize,
    createObjectUrl,
    revokeObjectUrl,
    createLink,
    getDate,
    showError,
    onSuccess,
  }: BackupDownloadDependencies,
) {
  if (inProgress.current) return;
  inProgress.current = true;
  setExporting(true);
  let url: string | undefined;
  try {
    const financialData = await fetchData();
    const blob = new Blob([serialize(financialData)], { type: "application/json" });
    url = createObjectUrl(blob);
    const link = createLink();
    link.href = url;
    link.download = `ezyRetire_Backup_${getDate().toISOString().split("T")[0]}.json`;
    link.click();
    onSuccess?.();
  } catch {
    showError();
  } finally {
    if (url) revokeObjectUrl(url);
    inProgress.current = false;
    setExporting(false);
  }
}

export async function restoreBackupText(
  contents: string,
  restore: (data: FinancialData) => Promise<FinancialData> = restoreFinancialData,
): Promise<FinancialData> {
  return restore(parseFinancialBackup(contents));
}

type CompletePlanDownloadDependencies = {
  fetchData: () => Promise<FinancialData>;
  buildSheets: typeof buildCompleteFinancialPlanSheets;
  downloadWorkbook: typeof downloadExcelWorkbook;
  showError: () => void;
  onSuccess?: () => void;
};

export async function runCompletePlanDownload(
  inProgress: { current: boolean },
  setExporting: (exporting: boolean) => void,
  {
    fetchData,
    buildSheets,
    downloadWorkbook,
    showError,
    onSuccess,
  }: CompletePlanDownloadDependencies,
) {
  if (inProgress.current) return;
  inProgress.current = true;
  setExporting(true);
  try {
    const financialData = await fetchData();
    downloadWorkbook(buildSheets(financialData), "complete_financial_plan");
    onSuccess?.();
  } catch {
    showError();
  } finally {
    inProgress.current = false;
    setExporting(false);
  }
}

export function DataManager({ loans = [], expenses }: DataManagerProps) {
  const importExpenses = useImportExpenses();
  const { toast } = useToast();
  const performFinancialOperation = useFinancialOperation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupExportRef = useRef(false);
  const completePlanExportRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [exportingPlan, setExportingPlan] = useState(false);
  const [open, setOpen] = useState(false);

  const exportSheets = buildTransactionReportSheets(
    expenses,
    (expense) => getLinkedLoanName(expense, loans),
  );

  const handleBackupExport = async () => {
    await runBackupDownload(backupExportRef, setExportingBackup, {
      fetchData: fetchFinancialData,
      serialize: serializeFinancialBackup,
      createObjectUrl: (blob) => URL.createObjectURL(blob),
      revokeObjectUrl: (url) => URL.revokeObjectURL(url),
      createLink: () => document.createElement("a"),
      getDate: () => new Date(),
      showError: () => toast({ title: "Export failed", variant: "default" }),
      onSuccess: () =>
        trackEvent("export_downloaded", { export_type: "backup" }),
    });
  };

  const handleCompletePlanExport = () =>
    runCompletePlanDownload(completePlanExportRef, setExportingPlan, {
      fetchData: fetchFinancialData,
      buildSheets: buildCompleteFinancialPlanSheets,
      downloadWorkbook: downloadExcelWorkbook,
      onSuccess: () =>
        trackEvent("export_downloaded", { export_type: "complete_plan" }),
      showError: () =>
        toast({
        title: "Excel download failed",
        description: "We couldn't create the complete financial plan. Please try again.",
        variant: "default",
        }),
    });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const reader = new FileReader();
    
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        if (file.name.toLowerCase().endsWith(".json")) {
          await performFinancialOperation(() => restoreBackupText(String(bstr)));
          toast({
            title: "Backup restored",
            description: "Expenses, income, investments, fund allocations, loans, and retirement settings were imported.",
          });
          setOpen(false);
          return;
        }
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        // Convert to JSON and normalize headers
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[];
        
        if (data.length <= 1) {
          throw new Error("File appears to be empty");
        }

        const headers = (data[0] as string[]).map((h) => String(h).toLowerCase().trim());
        
        // Map header indices
        const idIdx = headers.findIndex(h => h === "expense id" || h === "id");
        const dateIdx = headers.findIndex(h => h.includes('date') || h === 'time');
        const amountIdx = headers.findIndex(h => h.includes('amount') || h === 'cost' || h === 'price');
        const categoryIdx = headers.findIndex(h => h.includes('category') || h === 'type');
        const merchantIdx = headers.findIndex(h => h.includes('merchant') || h === 'payee' || h === 'vendor');
        const paymentIdx = headers.findIndex(h => h.includes('payment') || h === 'method' || h === 'account');
        const noteIdx = headers.findIndex(h => h.includes('note') || h === 'description' || h === 'memo');
        const reimbursableIdx = headers.findIndex(h => h.includes('reimbursable'));
        const recurringIdx = headers.findIndex(h => h.includes('recurring'));
        const linkedLoanIdx = headers.findIndex(h => h === "linked loan");
        const linkedLoanIdIdx = headers.findIndex(h => h === "linked loan id");
        const createdAtIdx = headers.findIndex(h => h === "created at");

        if (dateIdx === -1 || amountIdx === -1 || categoryIdx === -1) {
          throw new Error("Missing required columns: Date, Amount, and Category are mandatory.");
        }

        const newExpenses: ImportedExpense[] = [];
        let skipped = 0;
        let missingLoanLinks = 0;
        let ambiguousLoanLinks = 0;

        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (!row || row.length === 0 || !row[amountIdx]) {
            skipped++;
            continue;
          }

          const parsedDate = parseImportedExpenseDate(row[dateIdx]);
          if (!parsedDate) {
            skipped++;
            continue;
          }

          const amount = parseFloat(String(row[amountIdx]).replace(/[^0-9.-]+/g,""));
          if (isNaN(amount) || amount <= 0) {
            skipped++;
            continue;
          }

          const explicitLoanId = linkedLoanIdIdx >= 0 && row[linkedLoanIdIdx]
            ? String(row[linkedLoanIdIdx]).trim()
            : "";
          const linkedLoanName = linkedLoanIdx >= 0 && row[linkedLoanIdx]
            ? String(row[linkedLoanIdx]).trim()
            : "";
          let matchedLoanId: string | undefined;
          if (!explicitLoanId && linkedLoanName) {
            const match = matchLoanByName(linkedLoanName, loans);
            if (match.status === "matched") {
              matchedLoanId = match.loan.id;
            } else if (match.status === "ambiguous") {
              ambiguousLoanLinks++;
            } else {
              missingLoanLinks++;
            }
          }
          const importedExpense: ImportedExpense = {
            date: parsedDate.toISOString(),
            amount: amount,
            category: row[categoryIdx] ? String(row[categoryIdx]) : "Miscellaneous",
            merchant: row[merchantIdx] ? String(row[merchantIdx]) : "Unknown",
            paymentMethod: row[paymentIdx] ? String(row[paymentIdx]) : "Other",
            note: row[noteIdx] ? String(row[noteIdx]) : "",
            reimbursable: row[reimbursableIdx] ? String(row[reimbursableIdx]).toLowerCase() === 'yes' || String(row[reimbursableIdx]).toLowerCase() === 'true' : false,
            recurring: row[recurringIdx] ? String(row[recurringIdx]).toLowerCase() === 'yes' || String(row[recurringIdx]).toLowerCase() === 'true' : false,
            linkedLoanId: explicitLoanId || matchedLoanId,
          };
          if (idIdx >= 0 && row[idIdx]) {
            importedExpense.id = String(row[idIdx]).trim();
          }
          if (createdAtIdx >= 0 && row[createdAtIdx]) {
            importedExpense.createdAt = String(row[createdAtIdx]).trim();
          }
          newExpenses.push(importedExpense);
        }

        if (newExpenses.length === 0) {
          throw new Error("No valid records found to import.");
        }

        importExpenses.mutate(newExpenses, createExpenseImportMutationCallbacks({
          onSuccess: ({ added, duplicateCount }) => {
            toast({
              title: "Import successful",
              description: [
                `Imported ${added.length} records.`,
                duplicateCount > 0 ? `Skipped ${duplicateCount} duplicates.` : "",
                skipped > 0 ? `Skipped ${skipped} invalid rows.` : "",
                missingLoanLinks > 0
                  ? `${missingLoanLinks} loan ${missingLoanLinks === 1 ? "name was" : "names were"} not found and left unlinked.`
                  : "",
                ambiguousLoanLinks > 0
                  ? `${ambiguousLoanLinks} ambiguous loan ${ambiguousLoanLinks === 1 ? "name was" : "names were"} left unlinked.`
                  : "",
              ].filter(Boolean).join(" "),
            });
            setOpen(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
          },
          onError: () => {
            toast({
              title: "Import failed",
              description: "There was an error saving the imported data.",
              variant: "default",
            });
          }
        }));

      } catch (err: unknown) {
        if (!isFinancialAccountSwitchError(err)) {
          toast({
            title: file.name.toLowerCase().endsWith(".json") ? "Restore failed" : "Import Error",
            description: err instanceof Error ? err.message : "Failed to process the file.",
            variant: "default",
          });
        }
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    
    reader.onerror = () => {
      toast({
        title: "File Error",
        description: "Could not read the uploaded file.",
        variant: "default",
      });
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };

    if (file.name.toLowerCase().endsWith(".json")) {
      reader.readAsText(file);
    } else {
      reader.readAsBinaryString(file);
    }
  };

  return (
    <div className="sm:flex sm:gap-3">
      <div className="hidden sm:block">
        <BankStatementImport expenses={expenses} />
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="hidden sm:inline-flex">
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-serif">Import Data</DialogTitle>
            <DialogDescription>
              Restore a complete ezyRetire JSON backup, or import expenses from Excel/CSV.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted/50 p-4 rounded-lg text-sm border border-border">
              <h4 className="font-semibold flex items-center gap-2 mb-2">
                <Info className="h-4 w-4" /> Expected Columns
              </h4>
              <p className="text-muted-foreground mb-2">
                Your file must include at least these headers (case-insensitive):
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4 text-foreground/80 font-medium">
                <li>Date <span className="text-muted-foreground font-normal">(e.g., 2024-11-15)</span></li>
                <li>Amount <span className="text-muted-foreground font-normal">(numeric)</span></li>
                <li>Category <span className="text-muted-foreground font-normal">(e.g., Food & Dining)</span></li>
              </ul>
              <p className="text-muted-foreground mt-3 mb-1">Optional columns:</p>
              <ul className="list-disc list-inside space-y-1 ml-4 text-muted-foreground">
                <li>Merchant <span className="text-xs">(Payee or Vendor)</span></li>
                <li>Payment Method</li>
                <li>Note <span className="text-xs">(Description)</span></li>
                <li>Reimbursable <span className="text-xs">(Yes/No)</span></li>
                 <li>Recurring <span className="text-xs">(Yes/No)</span></li>
                 <li>Linked Loan <span className="text-xs">(must uniquely match a loan name)</span></li>
              </ul>
            </div>
            
            <div className="flex justify-end pt-2">
              <Input
                type="file"
                accept=".json,.xlsx,.xls,.csv"
                onChange={handleFileUpload}
                ref={fileInputRef}
                className="hidden"
                id="import-file"
              />
              <Button 
                onClick={() => fileInputRef.current?.click()}
                disabled={importing || importExpenses.isPending}
                className="w-full"
              >
                {importing ? "Processing..." : "Select File & Import"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="hidden gap-3 sm:flex">
        <CompletePlanDownloadButton
          exporting={exportingPlan}
          onDownload={handleCompletePlanExport}
        />
        <DownloadExcelButton
          sheets={exportSheets}
          reportSlug="transactions_report"
          trackedExportType="transaction_report"
        />
        <BackupDownloadButton
          exporting={exportingBackup}
          onDownload={handleBackupExport}
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full sm:hidden"
            aria-label="More expense tools"
          >
            <MoreVertical className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 p-1.5">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Data tools
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <BankStatementImport expenses={expenses} mobile />
          <CompletePlanDownloadButton
            mobile
            exporting={exportingPlan}
            onDownload={handleCompletePlanExport}
          />
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => setOpen(true)}
          >
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
          <DownloadExcelButton
            sheets={exportSheets}
            reportSlug="transactions_report"
            trackedExportType="transaction_report"
            className="w-full justify-start border-0 shadow-none"
            mobileOverflow={false}
          />
          <BackupDownloadButton
            mobile
            exporting={exportingBackup}
            onDownload={handleBackupExport}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
