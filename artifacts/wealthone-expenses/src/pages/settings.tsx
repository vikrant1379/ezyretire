import { useState, useEffect, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Bell, Monitor, Moon, Sun, ChevronRight, KeyRound, Trash2, Loader2, Download, Database, XCircle } from "lucide-react";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { useTheme } from "@/components/theme-provider";
import {
  getWebAuthnErrorMessage,
  isWebAuthnAvailable,
  parseCreationOptions,
  registrationCredentialToJSON,
} from "@/lib/webauthn";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/wealthone-design-system/components/ui/alert-dialog";
import {
  getGetAccountDeletionStatusQueryKey,
  useCancelAccountDeletion,
  useGetAccountDeletionStatus,
  useRequestAccountDeletion,
} from "@workspace/api-client-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@workspace/wealthone-design-system/components/ui/form";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { completeAccountDeletionSignOut } from "@/lib/account-deletion-sign-out";

const deletionConfirmationSchema = z.object({
  email: z.string().trim().email("Enter the email on this account."),
  confirmation: z.literal("DELETE MY ACCOUNT", {
    errorMap: () => ({ message: "Type DELETE MY ACCOUNT exactly." }),
  }),
});

function AppearanceEditor({ onCancel }: { onCancel: () => void }) {
  const { theme, setTheme } = useTheme();
  const choices = [
    { value: "light" as const, label: "Light", icon: Sun },
    { value: "dark" as const, label: "Dark", icon: Moon },
    { value: "system" as const, label: "System", icon: Monitor },
  ];

  return (
    <div className="space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4 motion-safe:duration-300">
      <div className="flex items-center gap-2 mb-6">
        <Button variant="ghost" size="icon" onClick={onCancel} className="h-11 w-11 -ml-2 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label="Back">
           <span className="-translate-y-px font-sans text-[24px] font-light leading-none" aria-hidden="true">‹</span>
        </Button>
        <h2 className="text-xl font-semibold">Appearance</h2>
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">Choose how ezyRetire looks on this device.</p>
        </div>
        <fieldset className="grid grid-cols-1 gap-3" aria-label="Theme preference">
          <legend className="sr-only">Theme preference</legend>
          {choices.map(({ value, label, icon: Icon }) => {
            const selected = theme === value;
            return (
              <label
                key={value}
                className={`relative flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground hover:bg-muted"
                }`}
                data-testid={`radio-theme-${value}`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="theme-preference"
                  value={value}
                  checked={selected}
                  onChange={() => setTheme(value)}
                />
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="flex-1 min-w-0 [overflow-wrap:anywhere]">{label}</span>
                {selected && (
                   <div className="h-2 w-2 rounded-full bg-primary" />
                )}
              </label>
            );
          })}
        </fieldset>
      </div>
    </div>
  );
}

type PasskeyView = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  createdAt?: string | null;
  lastUsedAt?: string | null;
};

function formatPasskeyDate(value?: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

class PasskeyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "PasskeyApiError";
  }
}

async function passkeyApi<T>(url: string, init?: RequestInit): Promise<T> {
  const isMutation = Boolean(init?.method && init.method.toUpperCase() !== "GET");
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: isMutation ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  });
  const body = await response.json().catch(() => null) as (T & { error?: string; reason?: string }) | null;
  if (!response.ok) {
    throw new PasskeyApiError(
      body?.error || "The passkey service is unavailable. Please try again.",
      response.status,
      body?.reason,
    );
  }
  if (response.status === 204) return undefined as T;
  if (body === null) throw new Error("The passkey service returned an invalid response.");
  return body;
}

function SecurityEditor({ onCancel }: { onCancel: () => void }) {
  const [passkeys, setPasskeys] = useState<PasskeyView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [newPasskeyName, setNewPasskeyName] = useState("My passkey");
  const [revokeTarget, setRevokeTarget] = useState<PasskeyView | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [requiresEmailVerification, setRequiresEmailVerification] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const supported = isWebAuthnAvailable();
  const secure = window.isSecureContext;

  async function loadPasskeys() {
    setIsLoading(true);
    try {
      const body = await passkeyApi<{ credentials?: PasskeyView[] } | PasskeyView[]>("/api/auth/passkeys");
      setPasskeys(Array.isArray(body) ? body : body.credentials || []);
      setError("");
      setLoadFailed(false);
      setRequiresEmailVerification(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load your passkeys.");
      setLoadFailed(true);
      setRequiresEmailVerification(
        loadError instanceof PasskeyApiError &&
          (loadError.reason === "current_session_email_verification_required" ||
            loadError.message.includes("Verify your email in this session")),
      );
    } finally {
      setIsLoading(false);
    }
  }

  function showPasskeyError(actionError: unknown, fallback: string) {
    setError(actionError instanceof Error ? actionError.message : fallback);
    setRequiresEmailVerification(
      actionError instanceof PasskeyApiError &&
        (actionError.reason === "current_session_email_verification_required" ||
          actionError.message.includes("Verify your email in this session")),
    );
  }

  useEffect(() => {
    void loadPasskeys();
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  async function addPasskey() {
    setError("");
    setStatus("");
    const passkeyName = newPasskeyName.trim();
    if (!passkeyName) {
      setError("Enter a name for your new passkey.");
      return;
    }
    setPendingAction("add");
    try {
      if (!online) throw new Error("Passkey setup needs an internet connection.");
      const body = await passkeyApi<{
        challengeId?: string;
        options?: Parameters<typeof parseCreationOptions>[0];
        publicKey?: Parameters<typeof parseCreationOptions>[0];
      }>("/api/auth/passkeys/registration/options", { method: "POST", body: "{}" });
      const publicKey = body.options || body.publicKey;
      if (!publicKey || !body.challengeId) throw new Error("The passkey service returned invalid setup details.");
      const credential = await navigator.credentials.create({
        publicKey: parseCreationOptions(publicKey),
      });
      if (!(credential instanceof PublicKeyCredential)) throw new Error("No passkey was created.");
      await passkeyApi("/api/auth/passkeys/registration/verify", {
        method: "POST",
        body: JSON.stringify({
          challengeId: body.challengeId,
          name: passkeyName,
          response: registrationCredentialToJSON(credential),
        }),
      });
      setStatus("Passkey added. You can now use it to sign in.");
      await loadPasskeys();
    } catch (addError) {
      if (addError instanceof DOMException) {
        setError(getWebAuthnErrorMessage(addError, "add"));
      } else {
        showPasskeyError(addError, "We couldn't add this passkey. Please try again.");
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function renamePasskey(event: FormEvent, passkey: PasskeyView) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      setError("Enter a name for this passkey.");
      return;
    }
    setPendingAction(passkey.id);
    setError("");
    try {
      await passkeyApi(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: nextName }),
      });
      setEditingId(null);
      setStatus("Passkey renamed.");
      await loadPasskeys();
    } catch (renameError) {
      showPasskeyError(renameError, "We couldn't rename this passkey.");
    } finally {
      setPendingAction(null);
    }
  }

  async function revokePasskey() {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setPendingAction(target.id);
    setError("");
    try {
      await passkeyApi(`/api/auth/passkeys/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
        body: "{}",
      });
      setRevokeTarget(null);
      setStatus("Passkey revoked. It can no longer sign in to your account.");
      await loadPasskeys();
    } catch (revokeError) {
      showPasskeyError(revokeError, "We couldn't revoke this passkey.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      <div className="space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4 motion-safe:duration-300">
        <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" size="icon" onClick={onCancel} className="h-11 w-11 -ml-2 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label="Back">
             <span className="-translate-y-px font-sans text-[24px] font-light leading-none" aria-hidden="true">‹</span>
          </Button>
          <h2 className="text-xl font-semibold">Security</h2>
        </div>

        <div className="space-y-6">
            <div className="rounded-xl border p-5">
              <h3 className="font-semibold mb-2">ezyRetire PIN</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Replace your four-digit PIN after verifying a fresh code sent to your account email.
              </p>
              <Button asChild variant="outline" className="w-full sm:w-auto min-h-11" data-testid="button-change-pin">
                <Link href="/login?changePin=true&returnTo=%2Fsettings" data-testid="link-change-pin">
                  Change PIN
                </Link>
              </Button>
            </div>

            <div className="rounded-xl border p-5 space-y-5">
              <div>
                  <h3 className="font-semibold mb-1">Passkeys</h3>
                  <p className="text-sm text-muted-foreground">Faster sign-in protected by your device.</p>
              </div>

              {!secure ? (
                <p role="status" className="rounded-lg border border-warning/30 bg-warning-background p-3 text-sm">
                  Passkeys require a secure HTTPS connection. Email-code sign-in remains available.
                </p>
              ) : !supported ? (
                <p role="status" className="rounded-lg border border-warning/30 bg-warning-background p-3 text-sm">
                  This browser or device doesn't support passkeys. You can continue signing in with an email code.
                </p>
              ) : !online ? (
                <p role="status" className="rounded-lg border border-warning/30 bg-warning-background p-3 text-sm">
                  You're offline. Reconnect to add or manage passkeys.
                </p>
              ) : null}

              {error && (
                <div role="alert" className="space-y-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive" data-testid="status-passkey-error">
                  <p>{error}</p>
                  <div className="flex flex-wrap gap-2">
                    {requiresEmailVerification ? (
                      <Button asChild size="sm" data-testid="link-verify-email-for-passkeys">
                        <Link href="/login?verify=passkeys&returnTo=%2Fsettings%3Fsection%3Dsecurity">Verify with email</Link>
                      </Button>
                    ) : loadFailed ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => void loadPasskeys()} data-testid="button-retry-passkeys">
                        Retry
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
              {status && <p role="status" aria-live="polite" className="rounded-lg border border-positive/20 bg-positive-background/70 p-3 text-sm text-positive" data-testid="status-passkey-success">{status}</p>}

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-2">
                    <label htmlFor="new-passkey-name" className="text-sm font-medium">New passkey name</label>
                    <Input id="new-passkey-name" value={newPasskeyName} onChange={(event) => setNewPasskeyName(event.target.value)} maxLength={80} className="h-11" data-testid="input-new-passkey-name" />
                  </div>
                  <Button type="button" className="min-h-11 shrink-0 gap-2" disabled={!supported || !online || loadFailed || requiresEmailVerification || pendingAction !== null} onClick={addPasskey} data-testid="button-add-passkey">
                    {pendingAction === "add" ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    {pendingAction === "add" ? "Adding…" : "Add a passkey"}
                  </Button>
                </div>
              </div>

              {isLoading ? (
                <p role="status" className="py-4 text-sm text-muted-foreground">Loading passkeys…</p>
              ) : loadFailed && passkeys.length === 0 ? (
                <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground" data-testid="text-passkeys-unavailable">
                  Your passkey list is unavailable until the security check above is completed.
                </p>
              ) : passkeys.length === 0 ? (
                <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground" data-testid="text-no-passkeys">No passkeys added yet.</p>
              ) : (
                <ul className="divide-y rounded-xl border" data-testid="list-passkeys">
                  {passkeys.map((passkey) => {
                    const displayName = passkey.name || passkey.displayName || "Unnamed passkey";
                    return (
                      <li key={passkey.id} className="p-4" data-testid={`row-passkey-${passkey.id}`}>
                        {editingId === passkey.id ? (
                          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => renamePasskey(event, passkey)}>
                            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} aria-label="Passkey name" autoFocus className="h-11" data-testid={`input-passkey-name-${passkey.id}`} />
                            <div className="flex gap-2">
                              <Button type="button" variant="ghost" className="min-h-11" onClick={() => setEditingId(null)} data-testid={`button-cancel-passkey-${passkey.id}`}>Cancel</Button>
                              <Button type="submit" className="min-h-11" disabled={pendingAction === passkey.id} data-testid={`button-save-passkey-${passkey.id}`}>Save</Button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{displayName}</p>
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Added {formatPasskeyDate(passkey.createdAt)} · Last used {formatPasskeyDate(passkey.lastUsedAt)}</p>
                            </div>
                            <div className="flex gap-2">
                              <Button type="button" variant="outline" className="min-h-11" onClick={() => { setEditingId(passkey.id); setName(displayName); setError(""); }} data-testid={`button-rename-passkey-${passkey.id}`}>Rename</Button>
                              <Button type="button" variant="outline" className="min-h-11 gap-2 text-destructive hover:text-destructive" onClick={() => setRevokeTarget(passkey)} data-testid={`button-revoke-passkey-${passkey.id}`}><Trash2 className="h-4 w-4" /> Revoke</Button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
        </div>
      </div>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => { if (!open && pendingAction === null) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this passkey?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.name || revokeTarget?.displayName || "This passkey"} will immediately stop working for sign-in. Other passkeys and email-code sign-in will continue to work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pendingAction !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={pendingAction !== null} onClick={(event) => { event.preventDefault(); void revokePasskey(); }} data-testid="button-confirm-revoke-passkey">
              {pendingAction === revokeTarget?.id ? "Revoking…" : "Revoke passkey"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


function DataEditor({ email, onCancel }: { email: string | null | undefined, onCancel: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const statusQuery = useGetAccountDeletionStatus({
    query: {
      queryKey: getGetAccountDeletionStatusQueryKey(),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "processing" || status === "blocked" ? 10_000 : false;
      },
    },
  });
  const requestDeletion = useRequestAccountDeletion();
  const cancelDeletion = useCancelAccountDeletion();
  const form = useForm<z.infer<typeof deletionConfirmationSchema>>({
    resolver: zodResolver(deletionConfirmationSchema),
    defaultValues: { email: "", confirmation: "" as "DELETE MY ACCOUNT" },
  });
  const status = statusQuery.data;
  const canCancel = status?.status === "cooling_off";

  const submitDeletion = form.handleSubmit((data) => {
    requestDeletion.mutate({ data }, {
      onSuccess: async () => {
        setDialogOpen(false);
        form.reset();
        await completeAccountDeletionSignOut(queryClient);
      },
      onError: (error) => {
        const recentAuthRequired = "status" in error && error.status === 403;
        toast({
          title: recentAuthRequired ? "Sign in again first" : "Deletion was not scheduled",
          description: recentAuthRequired
            ? "For your security, sign out and sign back in, then retry within 15 minutes."
            : "Check both confirmation fields and try again.",
          variant: "destructive",
        });
      },
    });
  });

  return (
    <>
      <div className="space-y-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4 motion-safe:duration-300">
        <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" size="icon" onClick={onCancel} className="h-11 w-11 -ml-2 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label="Back">
             <span className="-translate-y-px font-sans text-[24px] font-light leading-none" aria-hidden="true">‹</span>
          </Button>
          <h2 className="text-xl font-semibold">Data & privacy</h2>
        </div>

        <div className="space-y-6">
          <div className="flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold mb-1">Personal data export</h3>
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                Download a portable ZIP archive of your account information and vault files for
                personal records, portability, support or audit review, or future migration tools.
                It cannot currently be restored into ezyRetire.
              </p>
            </div>
            <Button asChild className="min-h-11 shrink-0 gap-2 w-full sm:w-auto mt-2 sm:mt-0">
              <a href="/api/account/export" download data-testid="link-export-personal-data">
                <Download className="h-4 w-4" /> Download ZIP
              </a>
            </Button>
          </div>

          {statusQuery.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground" data-testid="status-account-deletion-loading">
              Checking account status…
            </p>
          ) : status?.status && status.status !== "none" && status.status !== "cancelled" ? (
            <div className="rounded-xl border border-warning/30 bg-warning-background p-5" data-testid="status-account-deletion">
              <h3 className="font-semibold mb-1">
                {status.status === "cooling_off" ? "Deletion scheduled" : status.status === "blocked" ? "Cleanup retrying" : "Deletion processing"}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {status.status === "cooling_off" && status.scheduledFor
                  ? `Your seven-day cooling period ends ${new Date(status.scheduledFor).toLocaleString("en-IN")}.`
                  : status.status === "blocked"
                    ? "Secure object cleanup has not finished. No database data will be erased until cleanup succeeds."
                    : "Deletion has started and can no longer be cancelled."}
              </p>
              {canCancel && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 min-h-11 gap-2 w-full sm:w-auto"
                  disabled={cancelDeletion.isPending}
                  onClick={() => cancelDeletion.mutate(undefined, {
                    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAccountDeletionStatusQueryKey() }),
                  })}
                  data-testid="button-cancel-account-deletion"
                >
                  <XCircle className="h-4 w-4" />
                  {cancelDeletion.isPending ? "Cancelling…" : "Cancel deletion"}
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4 rounded-xl border border-negative/30 bg-negative-background/70 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-negative mb-1">Delete account</h3>
                <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                  This signs out every device immediately. You then have seven days to cancel before
                  your account, plans, transactions, vault files and support history are permanently erased.
                </p>
              </div>
              <Button type="button" variant="destructive" className="min-h-11 shrink-0 w-full sm:w-auto mt-2 sm:mt-0" onClick={() => setDialogOpen(true)} data-testid="button-open-account-deletion">
                Delete account
              </Button>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={dialogOpen} onOpenChange={(open) => { if (!requestDeletion.isPending) setDialogOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Export anything you need first. Every device will be signed out now. Deletion begins
              after a seven-day cooling period and cannot be undone once processing starts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Form {...form}>
            <form className="space-y-4" onSubmit={submitDeletion}>
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Account email</FormLabel>
                  <FormControl><Input {...field} placeholder={email || "you@example.com"} autoComplete="email" data-testid="input-delete-account-email" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="confirmation" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type DELETE MY ACCOUNT</FormLabel>
                  <FormControl><Input {...field} autoComplete="off" data-testid="input-delete-account-confirmation" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <AlertDialogFooter>
                <AlertDialogCancel type="button" disabled={requestDeletion.isPending}>Keep my account</AlertDialogCancel>
                <Button type="submit" variant="destructive" disabled={requestDeletion.isPending} data-testid="button-confirm-account-deletion">
                  {requestDeletion.isPending ? "Scheduling…" : "Schedule permanent deletion"}
                </Button>
              </AlertDialogFooter>
            </form>
          </Form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


export default function Settings() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const activeSection = searchParams.get("section");
  const closeSection = () => setLocation("/settings", { replace: true });

  if (activeSection === "appearance") {
     return <div className="mx-auto max-w-2xl pb-12 pt-4"><AppearanceEditor onCancel={closeSection} /></div>;
  }
  if (activeSection === "security" && isAuthenticated) {
     return <div className="mx-auto max-w-2xl pb-12 pt-4"><SecurityEditor onCancel={closeSection} /></div>;
  }
  if (activeSection === "data") {
     return <div className="mx-auto max-w-2xl pb-12 pt-4"><DataEditor email={user?.email} onCancel={closeSection} /></div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12 pt-2 md:pt-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
      <div className="mb-6">
        <h1 className="sr-only md:not-sr-only md:mb-2 font-serif text-2xl text-primary md:text-3xl" data-testid="heading-settings">Settings</h1>
        <Link href="/profile" className="inline-flex min-h-11 items-center text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Back to Profile</Link>
      </div>

      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
        <div className="divide-y divide-border/50">
          <Link href="/settings?section=appearance" className="flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sun className="h-4 w-4" />
              </div>
              <span className="font-medium text-[15px] min-w-0 [overflow-wrap:anywhere]">Appearance</span>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
          </Link>

          <Link href="/planner?tab=notifications" data-testid="link-manage-notifications" className="flex min-h-11 items-center justify-between gap-3 px-4 py-3.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Bell className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 font-medium [overflow-wrap:anywhere]">Notifications</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
          </Link>
          <Link href="/settings?section=security" className="flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <KeyRound className="h-4 w-4" />
              </div>
              <span className="font-medium text-[15px] min-w-0 [overflow-wrap:anywhere]">Security & access</span>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
          </Link>

          <Link href="/settings?section=data" className="flex min-h-11 items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Database className="h-4 w-4" />
              </div>
              <span className="font-medium text-[15px] min-w-0 [overflow-wrap:anywhere]">Data & privacy</span>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
          </Link>
        </div>
      </div>
    </div>
  );
}