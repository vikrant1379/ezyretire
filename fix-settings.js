const fs = require('fs');
const orig = fs.readFileSync('profile-original.tsx', 'utf-8');

const appearanceIdx = orig.indexOf('function AppearanceSection() {');
const profileIdx = orig.indexOf('export default function Profile() {');

const settingsContent = orig.slice(appearanceIdx, profileIdx);

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
import { PinKeypad } from "@/components/pin-keypad";
import { completeAccountDeletionSignOut, accountDeletionSignedOutPath } from "./profile";
import { AccountNav } from "@/components/account-nav";

// Duplicate these two from profile.tsx for data export and deletion validation
const deletionConfirmationSchema = z.object({
  email: z.string().trim().email("Enter the email on this account."),
  confirmation: z.literal("DELETE MY ACCOUNT", {
    errorMap: () => ({ message: "Type DELETE MY ACCOUNT exactly." }),
  }),
});
`;

const settingsDefault = `
export default function Settings() {
  const { logout } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 animate-in fade-in duration-500 pb-12">
      <div>
        <h1 className="text-3xl font-serif font-semibold tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground">Manage your app preferences, security, and data.</p>
      </div>

      <AccountNav />

      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold tracking-tight">App Settings</h2>
        <AppearanceSection />
      </div>

      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold tracking-tight">Security</h2>
        <PasskeySecuritySection />
        <PinSecuritySection />
      </div>

      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold tracking-tight">Data & Privacy</h2>
        <DataExportSection />
        <AccountDeletionSection />
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

fs.writeFileSync('artifacts/wealthone-expenses/src/pages/settings.tsx', imports + '\n' + settingsContent + '\n' + settingsDefault);
