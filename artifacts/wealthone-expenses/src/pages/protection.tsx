import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileLock2, FileUp, Image as ImageIcon, Loader2, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/wealthone-design-system/components/ui/dialog";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { Textarea } from "@workspace/wealthone-design-system/components/ui/textarea";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { deleteNominee, deleteVaultDocument, downloadVaultDocument, getEntitlements, getVaultCleanupStatus, listNominees, listVaultDocuments, replaceVaultDocument, retryVaultCleanup, saveNominee, updateVaultDocumentLifecycle, uploadVaultDocument, type Nominee, type VaultDocument } from "@/lib/feature-api";

const documentsKey = ["vault-documents"];
const nomineesKey = ["nominees"];
export const vaultCleanupStatusKey = ["vault-cleanup-status"];
const coverageTypes = [
  { value: "life", label: "Life insurance" },
  { value: "health", label: "Health insurance" },
  { value: "investment", label: "Investment or retirement account" },
  { value: "other", label: "Other asset or policy" },
] as const;

export function VaultDownloadButton({
  document,
  onError,
  download = downloadVaultDocument,
}: {
  document: Pick<VaultDocument, "id" | "name">;
  onError: (error: Error) => void;
  download?: typeof downloadVaultDocument;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void download(document).catch((error: unknown) => {
          onError(error instanceof Error ? error : new Error("The document could not be downloaded."));
        });
      }}
      data-testid={`button-download-vault-${document.id}`}
    >
      Download
    </Button>
  );
}

export default function Protection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [documentCategory, setDocumentCategory] = useState("Insurance");
  const [documentExpiry, setDocumentExpiry] = useState("");
  const [nomineeOpen, setNomineeOpen] = useState(false);
  const [editing, setEditing] = useState<Nominee | null>(null);
  const emptyNomineeForm = { name: "", relationship: "", allocationPercent: "100", dateOfBirth: "", contact: "", notes: "", coverageType: "life" as Nominee["coverageType"], coverageLabel: "", institution: "", status: "active" as Nominee["status"], reviewStatus: "not_reviewed" as Nominee["reviewStatus"], reminderOn: "" };
  const [form, setForm] = useState(emptyNomineeForm);
  const documents = useQuery({ queryKey: documentsKey, queryFn: listVaultDocuments });
  const nominees = useQuery({ queryKey: nomineesKey, queryFn: listNominees });
  const entitlements = useQuery({ queryKey: ["entitlements"], queryFn: getEntitlements, staleTime: 60_000 });
  const cleanupStatus = useQuery({ queryKey: vaultCleanupStatusKey, queryFn: getVaultCleanupStatus });
  const canUseVault = entitlements.data?.capabilities.documentVault === true;
  const upload = useMutation({
    mutationFn: ({ file, category, expiresOn }: { file: File; category: string; expiresOn?: string }) => uploadVaultDocument(file, category, expiresOn),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: documentsKey }); void queryClient.invalidateQueries({ queryKey: vaultCleanupStatusKey }); toast({ title: "Document secured in your vault" }); },
    onError: (error) => toast({ title: "Document not uploaded", description: error.message, variant: "destructive" }),
  });
  const removeDocument = useMutation({
    mutationFn: deleteVaultDocument,
    onSuccess: (result) => { void queryClient.invalidateQueries({ queryKey: documentsKey }); void queryClient.invalidateQueries({ queryKey: vaultCleanupStatusKey }); toast({ title: "Document deleted", description: result.cleanupPending ? "The document is removed from your vault. Private-byte cleanup remains pending." : "The document and its private bytes were deleted." }); },
    onError: (error) => toast({ title: "Document not deleted", description: error.message, variant: "destructive" }),
  });
  const lifecycle = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => updateVaultDocumentLifecycle(id, archived),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: documentsKey }),
    onError: (error) => toast({ title: "Document status not updated", description: error.message, variant: "destructive" }),
  });
  const replaceDocument = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => replaceVaultDocument(id, file, documentCategory),
    onSuccess: (result) => { void queryClient.invalidateQueries({ queryKey: documentsKey }); void queryClient.invalidateQueries({ queryKey: vaultCleanupStatusKey }); toast({ title: "Document replaced", description: result.cleanupPending ? "The replacement is saved. Cleanup of the previous private bytes remains pending." : "The replacement is saved and the previous private bytes were cleaned up." }); },
    onError: (error) => toast({ title: "Document not replaced", description: error.message, variant: "destructive" }),
  });
  const save = useMutation({
    mutationFn: saveNominee,
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: nomineesKey }); setNomineeOpen(false); toast({ title: "Nominee details saved" }); },
    onError: (error) => toast({ title: "Nominee not saved", description: error.message, variant: "destructive" }),
  });
  const removeNominee = useMutation({
    mutationFn: deleteNominee,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: nomineesKey }),
    onError: (error) => toast({ title: "Nominee not deleted", description: error.message, variant: "destructive" }),
  });
  const retryCleanup = useMutation({
    mutationFn: retryVaultCleanup,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: vaultCleanupStatusKey });
      toast({ title: result.cleanupPending ? "Private cleanup is still pending" : "Private cleanup completed", description: result.cleanupPending ? "Some private bytes could not be removed yet. You can retry again." : "Pending private bytes were removed." });
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: vaultCleanupStatusKey });
      toast({ title: "Private cleanup retry failed", description: error.message, variant: "destructive" });
    },
  });
  const openNominee = (nominee?: Nominee) => {
    setEditing(nominee ?? null);
    setForm(nominee ? {
      name: nominee.name,
      relationship: nominee.relationship,
      allocationPercent: String(nominee.allocationPercent),
      dateOfBirth: nominee.dateOfBirth ?? "",
      contact: nominee.contact ?? "",
      notes: nominee.notes ?? "",
      coverageType: nominee.coverageType,
      coverageLabel: nominee.coverageLabel,
      institution: nominee.institution ?? "",
      status: nominee.status,
      reviewStatus: nominee.reviewStatus,
      reminderOn: nominee.reminderOn ?? "",
    } : emptyNomineeForm);
    setNomineeOpen(true);
  };
  const dueReviews = (nominees.data ?? []).filter((nominee) => {
    if (nominee.reminderOn) return nominee.reminderOn <= new Date().toISOString().slice(0, 10);
    const reviewedAt = nominee.updatedAt ?? nominee.createdAt;
    return reviewedAt && new Date(reviewedAt).getTime() < Date.now() - 365 * 86400000;
  }).length;
  const incompleteCoverage = (nominees.data ?? []).filter((nominee) => nominee.gapStatus === "incomplete" || nominee.status === "needs_review" || nominee.reviewStatus === "needs_update");
  const visibleDocuments = (documents.data ?? []).filter((document) => Boolean(document.archivedAt) === showArchived);

  return (
    <div className="space-y-6 pb-10">
      <header><h1 className="font-serif text-3xl text-primary">Protection</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Keep important records protected and make account succession easier for the people you trust.</p></header>
      {(cleanupStatus.data?.pending ?? 0) > 0 && <section role="status" aria-live="polite" className="rounded-lg border border-warning/30 bg-warning p-4 text-sm text-warning dark:bg-warning-background dark:text-warning" data-testid="status-vault-cleanup"><p className="font-semibold">Private file cleanup is pending</p><p>{cleanupStatus.data!.failed > 0 ? `${cleanupStatus.data!.failed} cleanup ${cleanupStatus.data!.failed === 1 ? "attempt has" : "attempts have"} failed.` : `${cleanupStatus.data!.scheduled} ${cleanupStatus.data!.scheduled === 1 ? "item is" : "items are"} scheduled for cleanup.`}</p>{(cleanupStatus.data!.failed > 0 || cleanupStatus.data!.scheduled < cleanupStatus.data!.pending) && <Button className="mt-2" size="sm" variant="outline" disabled={retryCleanup.isPending} onClick={() => retryCleanup.mutate()} data-testid="button-retry-vault-cleanup">{retryCleanup.isPending ? "Retrying…" : "Retry cleanup"}</Button>}</section>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/20"><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><FileLock2 className="h-5 w-5" />Secure document vault</CardTitle><CardDescription className="mt-2">Files are sent through an authenticated connection and stored privately. They are never included in exports.</CardDescription></div><ShieldCheck className="h-6 w-6 text-primary" /></div></CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Select value={documentCategory} onValueChange={setDocumentCategory}><SelectTrigger className="sm:min-w-36 sm:flex-1" data-testid="select-vault-category"><SelectValue /></SelectTrigger><SelectContent>{["Insurance", "Investment", "Tax", "Property", "Identity", "Other"].map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select>
              <Input className="sm:min-w-44 sm:flex-1" type="date" value={documentExpiry} onChange={(event) => setDocumentExpiry(event.target.value)} aria-label="Document expiry date (optional)" data-testid="input-vault-expiry" />
              <input ref={fileRef} className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate({ file, category: documentCategory, expiresOn: documentExpiry || undefined }); event.target.value = ""; }} data-testid="input-vault-document" />
              <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending || !canUseVault} title={!entitlements.isLoading && !canUseVault ? "The secure vault is available on Premium" : undefined} data-testid="button-upload-vault-document">{upload.isPending ? <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}{entitlements.isLoading ? "Checking…" : canUseVault ? "Upload" : "Premium"}</Button>
              <Button variant="ghost" onClick={() => setShowArchived((value) => !value)} data-testid="button-toggle-archived-documents">{showArchived ? "Show active" : "Show archived"}</Button>
            </div>
            {documents.isLoading && <p role="status" className="text-sm text-muted-foreground">Opening your secure vault…</p>}
            {documents.isError && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{documents.error.message}</p>}
            {!documents.isLoading && !documents.isError && visibleDocuments.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No {showArchived ? "archived " : ""}documents yet.</div>}
            <ul className="divide-y">{visibleDocuments.map((document) => <li key={document.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`row-vault-document-${document.id}`}><FileLock2 className="h-4 w-4 text-primary" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{document.name}</p><p className="text-xs text-muted-foreground">{document.category} · {(document.size / 1024).toFixed(0)} KB · {document.archivedAt ? "Archived" : document.expiresOn && document.expiresOn < new Date().toISOString().slice(0, 10) ? "Expired" : document.expiresOn ? `Expires ${document.expiresOn}` : "No expiry"}</p></div>{document.contentType?.startsWith("image/") && <img src={`/api/vault/documents/${encodeURIComponent(document.id)}/preview`} alt="" className="h-10 w-10 rounded object-cover" />}{document.contentType?.startsWith("image/") && <ImageIcon className="h-4 w-4 text-muted-foreground" aria-label="Image preview available" />}<VaultDownloadButton document={document} onError={(error) => toast({ title: "Document not downloaded", description: error.message, variant: "destructive" })} /><input ref={replaceId === document.id ? replaceRef : undefined} className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) replaceDocument.mutate({ id: document.id, file }); event.target.value = ""; }} /><Button variant="ghost" size="sm" onClick={() => { setReplaceId(document.id); window.setTimeout(() => replaceRef.current?.click(), 0); }} data-testid={`button-replace-vault-${document.id}`}>Replace</Button><Button variant="ghost" size="sm" onClick={() => lifecycle.mutate({ id: document.id, archived: !document.archivedAt })} data-testid={`button-archive-vault-${document.id}`}>{document.archivedAt ? "Restore" : "Archive"}</Button><Button variant="ghost" size="icon" aria-label={`Delete ${document.name}`} onClick={() => setDeleteId(document.id)} data-testid={`button-delete-vault-${document.id}`}><Trash2 className="h-4 w-4" /></Button></li>)}</ul>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/20"><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Nominee coverage</CardTitle><CardDescription className="mt-2">Track who is nominated across your accounts. This checklist does not replace nomination with each institution.</CardDescription></div><Button size="sm" onClick={() => openNominee()} data-testid="button-add-nominee"><Plus className="mr-2 h-4 w-4" />Add</Button></div></CardHeader>
          <CardContent className="space-y-4 pt-5">
            {dueReviews > 0 && <div className="rounded-lg border border-warning/30 bg-warning p-3 text-sm text-warning dark:bg-warning-background dark:text-warning" data-testid="status-nominee-reminders">{dueReviews} nominee {dueReviews === 1 ? "review is" : "reviews are"} due. Confirm the institution still has the right details.</div>}
            {incompleteCoverage.length > 0 && <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground" data-testid="status-nominee-gaps">Review {incompleteCoverage.length} incomplete coverage {incompleteCoverage.length === 1 ? "record" : "records"} below.</div>}
            {nominees.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading nominee coverage…</p>}
            {nominees.isError && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{nominees.error.message}</p>}
            {!nominees.isLoading && !nominees.isError && nominees.data?.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No nominee coverage recorded yet.</div>}
            <ul className="space-y-3">{nominees.data?.map((nominee) => <li key={nominee.id} className="rounded-lg border p-4" data-testid={`card-nominee-${nominee.id}`}><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{nominee.name}</p><p className="text-sm text-muted-foreground">{nominee.relationship} · {nominee.allocationPercent}%</p><p className="mt-1 text-xs text-muted-foreground">{coverageTypes.find((item) => item.value === nominee.coverageType)?.label ?? "Other"} · {nominee.coverageLabel}{nominee.institution ? ` · ${nominee.institution}` : ""}</p><p className="mt-1 text-xs font-medium">{nominee.gapStatus === "complete" ? "Allocation complete" : "Allocation incomplete"} · {nominee.reviewStatus.replaceAll("_", " ")}</p></div><div><Button variant="ghost" size="sm" onClick={() => openNominee(nominee)} data-testid={`button-edit-nominee-${nominee.id}`}>Review</Button><Button variant="ghost" size="icon" aria-label={`Delete ${nominee.name}`} onClick={() => removeNominee.mutate(nominee.id)} data-testid={`button-delete-nominee-${nominee.id}`}><Trash2 className="h-4 w-4" /></Button></div></div>{nominee.contact && <p className="mt-2 text-sm">{nominee.contact}</p>}<p className="mt-2 text-xs text-muted-foreground">Last reviewed {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(nominee.updatedAt ?? nominee.createdAt ?? Date.now()))}</p></li>)}</ul>
          </CardContent>
        </Card>
      </div>
      <Dialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}><DialogContent><DialogHeader><DialogTitle>Delete this vault document?</DialogTitle><DialogDescription>This permanently removes the document from your private vault. This cannot be undone.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDeleteId(null)} data-testid="button-cancel-delete-vault">Cancel</Button><Button variant="destructive" disabled={removeDocument.isPending} onClick={() => { if (deleteId) removeDocument.mutate(deleteId, { onSettled: () => setDeleteId(null) }); }} data-testid="button-confirm-delete-vault">Delete permanently</Button></div></DialogContent></Dialog>
      <Dialog open={nomineeOpen} onOpenChange={setNomineeOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? "Review nominee coverage" : "Add nominee coverage"}</DialogTitle><DialogDescription>Keep a coverage allocation here, then confirm the legal nomination directly with each institution. Set a reminder for the next review.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate({ ...(editing ? { id: editing.id } : {}), name: form.name.trim(), relationship: form.relationship.trim(), allocationPercent: Number(form.allocationPercent), dateOfBirth: form.dateOfBirth || null, contact: form.contact.trim() || null, coverageType: form.coverageType, coverageLabel: form.coverageLabel.trim(), institution: form.institution.trim(), status: form.status, reviewStatus: form.reviewStatus, reminderOn: form.reminderOn || null, notes: form.notes.trim() || null }); }}><div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="nominee-name">Full name</Label><Input id="nominee-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-nominee-name" /></div><div><Label htmlFor="nominee-relationship">Relationship</Label><Input id="nominee-relationship" required value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} data-testid="input-nominee-relationship" /></div><div><Label htmlFor="nominee-coverage">Coverage type</Label><Select value={form.coverageType} onValueChange={(value) => setForm({ ...form, coverageType: value as Nominee["coverageType"] })}><SelectTrigger id="nominee-coverage" data-testid="select-nominee-coverage"><SelectValue /></SelectTrigger><SelectContent>{coverageTypes.map((item) => <SelectItem value={item.value} key={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="nominee-asset">Asset / policy label</Label><Input id="nominee-asset" required value={form.coverageLabel} onChange={(e) => setForm({ ...form, coverageLabel: e.target.value })} data-testid="input-nominee-asset" /></div><div><Label htmlFor="nominee-allocation">Allocation % for this target</Label><Input id="nominee-allocation" required type="number" min="0" max="100" step="1" value={form.allocationPercent} onChange={(e) => setForm({ ...form, allocationPercent: e.target.value })} data-testid="input-nominee-allocation" /></div><div><Label htmlFor="nominee-institution">Institution (optional)</Label><Input id="nominee-institution" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} data-testid="input-nominee-institution" /></div><div><Label htmlFor="nominee-reminder">Review reminder</Label><Input id="nominee-reminder" type="date" value={form.reminderOn} onChange={(e) => setForm({ ...form, reminderOn: e.target.value })} data-testid="input-nominee-review" /></div><div><Label htmlFor="nominee-status">Coverage status</Label><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as Nominee["status"] })}><SelectTrigger id="nominee-status" data-testid="select-nominee-status"><SelectValue /></SelectTrigger><SelectContent>{["active", "needs_review", "inactive"].map((value) => <SelectItem value={value} key={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="nominee-review-status">Review status</Label><Select value={form.reviewStatus} onValueChange={(value) => setForm({ ...form, reviewStatus: value as Nominee["reviewStatus"] })}><SelectTrigger id="nominee-review-status" data-testid="select-nominee-review-status"><SelectValue /></SelectTrigger><SelectContent>{["not_reviewed", "reviewed", "needs_update"].map((value) => <SelectItem value={value} key={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div></div><div><Label htmlFor="nominee-dob">Date of birth</Label><Input id="nominee-dob" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} data-testid="input-nominee-date-of-birth" /></div><div><Label htmlFor="nominee-contact">Contact</Label><Input id="nominee-contact" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} data-testid="input-nominee-contact" /></div><div><Label htmlFor="nominee-notes">Notes</Label><Textarea id="nominee-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-nominee-notes" /></div><Button className="w-full" type="submit" disabled={save.isPending} data-testid="button-save-nominee">{save.isPending ? "Saving…" : "Save coverage"}</Button></form></DialogContent></Dialog>
    </div>
  );
}
