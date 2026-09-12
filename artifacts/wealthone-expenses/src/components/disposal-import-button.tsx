"use client";

import { useState, useRef } from "react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@workspace/wealthone-design-system/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/wealthone-design-system/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Upload, AlertTriangle, CheckCircle2, FileSpreadsheet, Info, XCircle } from "lucide-react";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import {
  parseBrokerExport,
  createDisposalImportBatch,
  type DisposalFingerprintInput,
  type ParsedDisposalRow,
} from "@/lib/disposal-import";
import { formatINR } from "@/lib/utils";
import type {
  AssetClass,
  CapitalGainsAssetType,
  InvestmentDisposal,
} from "@/lib/storage";

const ASSET_TYPES = [
  "Listed Equity",
  "Equity Mutual Fund",
  "Unlisted Equity",
  "Real Estate",
  "Gold",
  "Debt Mutual Fund",
  "Listed Bonds",
  "Crypto",
] as const satisfies readonly CapitalGainsAssetType[];

const mapAssetClassToType = (assetClass: AssetClass): CapitalGainsAssetType => {
  if (assetClass === "Direct Equity") return "Listed Equity";
  if (assetClass === "Mutual Funds") return "Equity Mutual Fund";
  if (assetClass === "Real Estate") return "Real Estate";
  if (assetClass === "Gold") return "Gold";
  if (assetClass === "Bonds") return "Listed Bonds";
  if (assetClass === "Crypto") return "Crypto";
  return "Listed Equity";
};

const normalizeAssetType = (
  value: string | undefined,
  fallback: CapitalGainsAssetType,
): CapitalGainsAssetType => {
  const exact = ASSET_TYPES.find(
    (assetType) => assetType.toLowerCase() === value?.trim().toLowerCase(),
  );
  if (exact) return exact;
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.includes("mutual") && normalized.includes("debt")) return "Debt Mutual Fund";
  if (normalized.includes("mutual") || normalized.includes("fund")) return "Equity Mutual Fund";
  if (normalized.includes("unlisted")) return "Unlisted Equity";
  if (normalized.includes("equity") || normalized.includes("stock")) return "Listed Equity";
  if (normalized.includes("bond")) return "Listed Bonds";
  if (normalized.includes("gold")) return "Gold";
  if (normalized.includes("real estate") || normalized.includes("property")) return "Real Estate";
  if (normalized.includes("crypto")) return "Crypto";
  return fallback;
};

export type ImportedDisposalFormValue = InvestmentDisposal & {
  purchaseDate: string;
  saleDate: string;
  costBasis: number;
  proceeds: number;
  assetType: CapitalGainsAssetType;
  eligibleExemption: number;
  createdAt: string;
  importBatchId: string;
  importedAt: string;
};

export function DisposalImportButton({
  existingDisposals,
  onImport,
  defaultAssetClass,
}: {
  existingDisposals: DisposalFingerprintInput[];
  onImport: (disposals: ImportedDisposalFormValue[]) => void;
  defaultAssetClass: AssetClass;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedDisposalRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const buffer = await file.arrayBuffer();
      const defaultType = mapAssetClassToType(defaultAssetClass);
      
      let parsedRows = parseBrokerExport(buffer, existingDisposals);
      parsedRows = parsedRows.map((row) => {
        if (row.status === "sale") {
          return {
            ...row,
            parsed: {
              ...row.parsed,
              assetType: normalizeAssetType(row.parsed.assetType, defaultType),
              eligibleExemption: row.parsed.eligibleExemption ?? 0,
            },
          };
        }
        return row;
      });

      setRows(parsedRows);
      if (parsedRows.length === 0) {
        toast({
          title: "No trade rows found",
          description: "The first sheet is empty or does not contain a header row.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error(err);
      toast({
        title: "Import failed",
        description: "Could not read the file. Ensure it is a valid CSV or Excel file.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const updateRow = (index: number, updates: Partial<ParsedDisposalRow["parsed"]>) => {
    setRows((current) =>
      current.map((r, i) =>
        i === index ? { ...r, parsed: { ...r.parsed, ...updates } } : r
      )
    );
  };

  const handleConfirm = () => {
    const batch = createDisposalImportBatch();
    const validSales = rows
      .filter((r) => r.status === "sale")
      .map((r): ImportedDisposalFormValue => ({
        id: crypto.randomUUID(),
        name: r.parsed.name!,
        purchaseDate: r.parsed.purchaseDate!,
        saleDate: r.parsed.saleDate!,
        costBasis: r.parsed.costBasis!,
        proceeds: r.parsed.proceeds!,
        assetType: r.parsed.assetType as CapitalGainsAssetType,
        eligibleExemption: r.parsed.eligibleExemption ?? 0,
        createdAt: new Date().toISOString(),
        importBatchId: batch.id,
        importedAt: batch.importedAt,
      }));

    onImport(validSales);
    setOpen(false);
    toast({
      title: `${validSales.length} ${validSales.length === 1 ? "sale" : "sales"} added for review`,
      description: "Save the investment to persist these imported disposals.",
    });
  };

  const salesCount = rows.filter((r) => r.status === "sale").length;
  const duplicateCount = rows.filter((r) => r.status === "duplicate").length;
  const unsupportedCount = rows.filter((r) => r.status === "unsupported").length;
  const purchaseCount = rows.filter((r) => r.status === "purchase").length;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="button-import-broker-sales"
        onClick={() => setOpen(true)}
      >
        <Upload className="h-4 w-4 mr-2" />
        Import broker sales
      </Button>

      <Dialog open={open} onOpenChange={(val) => {
        if (!val) setRows([]);
        setOpen(val);
      }}>
        <DialogContent className="max-w-5xl flex flex-col p-6">
          <DialogHeader className="mb-2">
            <DialogTitle className="font-serif text-2xl">Import broker sales</DialogTitle>
            <DialogDescription>
              Upload a CSV or Excel export. Review every mapped row before adding
              new sales to this investment.
            </DialogDescription>
          </DialogHeader>

          {!rows.length && (
            <div className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed rounded-xl border-border bg-muted/20">
              <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                <FileSpreadsheet className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-medium text-lg mb-2">Upload your trades</h3>
              <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
                Supports CSV, XLS, and XLSX files with trade type, security,
                purchase and sale dates, cost basis, and proceeds.
              </p>
              <input
                type="file"
                accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
              <Button size="lg" onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
                {isProcessing ? "Reading file..." : "Choose broker file"}
              </Button>
            </div>
          )}

          {rows.length > 0 && (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="flex flex-wrap gap-4 text-sm mb-4 bg-muted/40 p-4 rounded-lg border">
                <div className="flex items-center gap-2 text-positive font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                   {salesCount} {salesCount === 1 ? "sale" : "sales"} ready
                </div>
                {purchaseCount > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Info className="h-4 w-4" />
                     {purchaseCount} {purchaseCount === 1 ? "purchase" : "purchases"} mapped
                  </div>
                )}
                {duplicateCount > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Info className="h-4 w-4" />
                     {duplicateCount} already recorded
                  </div>
                )}
                {unsupportedCount > 0 && (
                  <div className="flex items-center gap-2 text-warning">
                    <AlertTriangle className="h-4 w-4" />
                     {unsupportedCount} unsupported
                  </div>
                )}
              </div>

              <div className="overflow-auto border rounded-lg flex-1">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-10">
                        <span className="sr-only">Status</span>
                      </TableHead>
                      <TableHead>Asset</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead className="text-right">Amounts</TableHead>
                      <TableHead className="w-72">Tax review</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, idx) => (
                      <TableRow key={row.id} className={row.status === "sale" ? "" : "opacity-60 bg-muted/10 hover:bg-muted/10"}>
                        <TableCell className="text-center">
                          <span className="sr-only">
                            {row.status === "sale" && "Ready to import"}
                            {row.status === "duplicate" && "Already recorded"}
                            {row.status === "purchase" && "Purchase mapped for review only"}
                            {row.status === "unsupported" && `Unsupported: ${row.reason ?? "unknown reason"}`}
                          </span>
                          {row.status === "sale" && <CheckCircle2 className="h-4 w-4 text-positive mx-auto" />}
                          {row.status === "duplicate" && <Info aria-hidden="true" className="h-4 w-4 text-muted-foreground mx-auto" />}
                          {row.status === "purchase" && <Info aria-hidden="true" className="h-4 w-4 text-muted-foreground mx-auto" />}
                          {row.status === "unsupported" && <XCircle aria-hidden="true" className="h-4 w-4 text-warning mx-auto" />}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{row.parsed.name || "Unknown"}</div>
                          {row.status !== "sale" && (
                            <div className="text-xs text-muted-foreground mt-0.5">{row.reason}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs space-y-1">
                          <div className="flex justify-between max-w-[120px]">
                            <span className="text-muted-foreground mr-2">Buy</span>
                            <span className="font-mono">{row.parsed.purchaseDate || "—"}</span>
                          </div>
                          <div className="flex justify-between max-w-[120px]">
                            <span className="text-muted-foreground mr-2">Sell</span>
                            <span className="font-mono">{row.parsed.saleDate || "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs space-y-1">
                          <div className="flex justify-end gap-2">
                            <span className="text-muted-foreground">Cost</span>
                            <span className="font-mono min-w-[70px]">{row.parsed.costBasis ? formatINR(row.parsed.costBasis) : "—"}</span>
                          </div>
                          <div className="flex justify-end gap-2">
                            <span className="text-muted-foreground">Net</span>
                            <span className="font-mono min-w-[70px]">{row.parsed.proceeds ? formatINR(row.parsed.proceeds) : "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.status === "sale" ? (
                            <div className="flex flex-col gap-2">
                              <Select
                                 value={row.parsed.assetType ?? ""}
                                onValueChange={(val) => updateRow(idx, { assetType: val })}
                              >
                                 <SelectTrigger
                                   className="h-8 text-xs"
                                   aria-label={`Asset type for ${row.parsed.name ?? `sale ${idx + 1}`}`}
                                 >
                                  <SelectValue placeholder="Asset type" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSET_TYPES.map((t) => (
                                    <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <div className="flex items-center gap-2">
                                  <label htmlFor={`import-exemption-${idx}`} className="text-xs text-muted-foreground shrink-0 w-16">
                                    Exemption
                                  </label>
                                <Input
                                   id={`import-exemption-${idx}`}
                                  type="number"
                                   min="0"
                                   step="0.01"
                                  className="h-8 text-right text-xs"
                                   value={row.parsed.eligibleExemption ?? 0}
                                   onChange={(e) => updateRow(idx, {
                                     eligibleExemption: Math.max(0, Number(e.target.value) || 0),
                                   })}
                                  placeholder="0"
                                />
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground flex items-center h-full">Not applicable</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <DialogFooter className="mt-6 pt-4 border-t">
                <div className="mr-auto max-w-md text-xs text-muted-foreground">
                  By confirming, you verify the asset types and exemptions shown
                  above. Purchases, duplicates, and unsupported rows will not be saved.
                </div>
                 <Button type="button" variant="outline" onClick={() => setRows([])}>
                   Choose another file
                </Button>
                 <Button type="button" onClick={handleConfirm} disabled={salesCount === 0}>
                   Confirm and add {salesCount} {salesCount === 1 ? "sale" : "sales"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
