import { Trash2 } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/wealthone-design-system/components/ui/alert-dialog";

export function ConfirmDeleteButton({
  itemName,
  entityLabel,
  onConfirm,
  variant = "ghost",
}: {
  itemName: string;
  entityLabel: string;
  onConfirm: () => void;
  variant?: "ghost" | "outline";
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant={variant}
          size="icon"
          className={
            variant === "outline"
              ? "text-destructive hover:bg-destructive/10 border-destructive/20"
              : "text-destructive hover:bg-destructive/10"
          }
          aria-label={`Delete ${itemName}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {itemName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this {entityLabel}. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
