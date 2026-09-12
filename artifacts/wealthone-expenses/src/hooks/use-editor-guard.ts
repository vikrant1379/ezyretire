import { useCallback, useEffect, useRef } from "react";

export const unsavedChangesMessage = "You have unsaved changes. Are you sure you want to leave?";
const editorHistorySentinelKey = "__ezyRetireEditorGuardSentinel";

export type AnchorNavigation = {
  currentUrl: string;
  href: string;
  target?: string | null;
  download?: boolean;
  modified?: boolean;
};

/**
 * Links handled by the SPA need an explicit prompt. Cross-origin links and
 * downloads are deliberately left to the browser (and its beforeunload
 * prompt), because they do not replace this document through the router.
 */
export function shouldConfirmAnchorNavigation(
  isDirty: boolean,
  { currentUrl, href, target, download = false, modified = false }: AnchorNavigation,
) {
  if (!isDirty || download || modified || (target && target !== "_self")) return false;

  const current = new URL(currentUrl);
  const destination = new URL(href, current);
  return (
    destination.origin === current.origin &&
    (destination.pathname !== current.pathname || destination.search !== current.search)
  );
}

function isEditorHistorySentinel(state: unknown) {
  return (
    typeof state === "object" &&
    state !== null &&
    editorHistorySentinelKey in state &&
    (state as Record<string, unknown>)[editorHistorySentinelKey] === true
  );
}

export function useEditorGuard(isDirty: boolean) {
  const isDirtyRef = useRef(isDirty);
  const restoringHistoryRef = useRef(false);
  const ownsHistorySentinelRef = useRef(false);
  const pendingExitRef = useRef<string | null>(null);
  const navigateAfterDiscardRef = useRef<(destination: string) => void>(() => {
    throw new Error("The editor guard is not ready to navigate.");
  });
  isDirtyRef.current = isDirty;

  // Calling this before a successful-save navigation avoids relying on a
  // later React render to update formState.isDirty.
  const markClean = useCallback(() => {
    isDirtyRef.current = false;
  }, []);

  const confirmDiscard = useCallback(() => {
    if (!isDirtyRef.current) return true;

    const confirmed = window.confirm(unsavedChangesMessage);
    if (confirmed) markClean();
    return confirmed;
  }, [markClean]);

  useEffect(() => {
    const sameDocument = (destination: string) => {
      const target = new URL(destination, window.location.href);
      return (
        target.pathname === window.location.pathname &&
        target.search === window.location.search &&
        target.hash === window.location.hash
      );
    };

    const completeExit = (replace = false) => {
      const destination = pendingExitRef.current;
      if (!destination) return;
      pendingExitRef.current = null;
      if (sameDocument(destination)) return;
      window.history[replace ? "replaceState" : "pushState"](null, "", destination);
    };

    const navigateAfterDiscard = (destination: string) => {
      // Traverse the sentinel, then replace the original editor entry with
      // the explicit destination. This means Back never reopens an exited
      // editor, including when the editor was opened directly.
      pendingExitRef.current = destination;
      if (!ownsHistorySentinelRef.current) {
        completeExit();
        return;
      }
      ownsHistorySentinelRef.current = false;
      window.history.back();
    };
    navigateAfterDiscardRef.current = navigateAfterDiscard;

    // A sentinel gives a Back action somewhere safe to land while the user
    // decides. We never rewrite a previous URL or monkey-patch history. The
    // extra same-URL entry is automatically skipped for a clean editor.
    if (isEditorHistorySentinel(window.history.state)) {
      ownsHistorySentinelRef.current = true;
    } else {
      const previousState =
        typeof window.history.state === "object" && window.history.state !== null
          ? window.history.state
          : {};
      window.history.pushState(
        { ...previousState, [editorHistorySentinelKey]: true },
        "",
        window.location.href,
      );
      ownsHistorySentinelRef.current = true;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;

      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || !anchor.href) return;

      if (
        !shouldConfirmAnchorNavigation(isDirtyRef.current, {
          currentUrl: window.location.href,
          href: anchor.href,
          target: anchor.target,
          download: anchor.hasAttribute("download"),
          modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
        })
      ) {
        return;
      }

      if (!confirmDiscard()) {
        event.preventDefault();
        // This listener runs in capture phase, before Wouter's click handler.
        // Stopping here prevents the rejected link from reaching the router.
        event.stopPropagation();
      } else {
        // Wouter would otherwise push from the sentinel, retaining a stale
        // editor entry behind the destination.
        event.preventDefault();
        event.stopPropagation();
        navigateAfterDiscard(anchor.href);
      }
    };

    const handlePopState = (event: PopStateEvent) => {
      if (restoringHistoryRef.current) {
        restoringHistoryRef.current = false;
        return;
      }

      const pendingExit = pendingExitRef.current;
      if (pendingExit) {
        // We just traversed from the sentinel to the original editor entry.
        // Replace it rather than traversing again: direct entries may have a
        // previous document, and must still close to the explicit destination.
        completeExit(true);
        return;
      }

      const leavingSentinel = ownsHistorySentinelRef.current && !isEditorHistorySentinel(event.state);
      if (!leavingSentinel) return;

      if (isDirtyRef.current && !confirmDiscard()) {
        // popstate itself cannot be cancelled. Returning to the sentinel
        // preserves the mounted editor and its draft without adding history.
        restoringHistoryRef.current = true;
        window.history.forward();
        return;
      }

      // A successful discard (or a clean editor) must continue past the
      // original editor entry rather than making Back appear to do nothing.
      ownsHistorySentinelRef.current = false;
      window.history.back();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.document.addEventListener("click", handleClick, { capture: true });
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.document.removeEventListener("click", handleClick, { capture: true });
      window.removeEventListener("popstate", handlePopState);
    };
  }, [confirmDiscard]);

  const navigateAfterDiscard = useCallback(
    (destination: string) => navigateAfterDiscardRef.current(destination),
    [],
  );

  return { confirmDiscard, markClean, navigateAfterDiscard };
}