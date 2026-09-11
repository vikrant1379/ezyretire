const fs = require('fs');

const orig = fs.readFileSync('profile-original.tsx', 'utf-8');

const appearanceIdx = orig.indexOf('function AppearanceSection() {');
const profileIdx = orig.indexOf('export default function Profile() {');
const accountDataIdx = orig.indexOf('function AccountDataControls');

const appearanceAndPasskey = orig.slice(appearanceIdx, profileIdx);
const accountData = orig.slice(accountDataIdx);

const imports = `
import { useState, useEffect, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { LogOut, Moon, Bell, ChevronRight, ChevronDown, KeyRound, Trash2, Loader2, Download, Database, XCircle } from "lucide-react";
import { Switch } from "@workspace/wealthone-design-system/components/ui/switch";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
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
import { completeAccountDeletionSignOut, accountDeletionSignedOutPath } from "./profile";
import { AccountNav } from "@/components/account-nav";
import { activateFinancialDataAccount, removePushSubscription } from "@/lib/financial-api";
import { carryPendingFinancialChangeNoticeAcrossLogout } from "@/hooks/use-financial-write";

const deletionConfirmationSchema = z.object({
  email: z.string().trim().email("Enter the email on this account."),
  confirmation: z.literal("DELETE MY ACCOUNT", {
    errorMap: () => ({ message: "Type DELETE MY ACCOUNT exactly." }),
  }),
});
`;

const settingsDefault = `
export default function Settings() {
  const { user, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    if (carryPendingFinancialChangeNoticeAcrossLogout(queryClient)) {
      activateFinancialDataAccount(null);
    }
    try {
      const registration = await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        try {
          await removePushSubscription(subscription.endpoint);
        } finally {
          await subscription.unsubscribe();
        }
      }
    } catch {
      // Logout must still succeed
    }
    await logout();
    setLocation("/");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 animate-in fade-in duration-500 pb-12 font-sans">
      <div>
        <h1 className="text-3xl font-serif font-semibold tracking-tight mb-2 text-primary">Settings</h1>
        <p className="text-muted-foreground">Manage your app preferences, security, and data.</p>
      </div>

      <AccountNav />

      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold tracking-tight">App Settings</h2>
        <AppearanceSection />
      </div>

      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold tracking-tight">Security</h2>
        {isAuthenticated && <PasskeySecuritySection />}
        
        {isAuthenticated && (
          <Card className="overflow-hidden border-border bg-card shadow-sm">
            <CardHeader className="flex flex-row items-center gap-3 border-b border-border px-5 py-4 sm:px-6 bg-muted/20">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold text-card-foreground">ezyRetire PIN</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                    Replace your four-digit PIN after verifying a fresh code sent to your account email.
                  </p>
                </div>
                <Button asChild variant="outline" className="min-h-11 shrink-0 shadow-sm hover:bg-muted" data-testid="button-change-pin">
                  <Link href="/login?changePin=true&returnTo=%2Fsettings" data-testid="link-change-pin">
                    Change PIN
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold tracking-tight">Data & Privacy</h2>
        <AccountDataControls email={user?.email} />
      </div>

      <div className="pt-6 border-t border-border/40">
        <Button variant="outline" className="w-full sm:w-auto text-destructive border-destructive/20 hover:bg-destructive/10" onClick={handleLogout} data-testid="button-sign-out">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
`;

fs.writeFileSync('artifacts/wealthone-expenses/src/pages/settings.tsx', imports + '\n' + appearanceAndPasskey + '\n' + accountData + '\n' + settingsDefault);
