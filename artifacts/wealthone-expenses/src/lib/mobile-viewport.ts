const KEYBOARD_THRESHOLD_PX = 80;
const FOCUSABLE_FIELD_SELECTOR =
  'input:not([type="hidden"]), textarea, select, [role="combobox"], [contenteditable="true"]';
const FLOATING_SURFACE_SELECTOR = "[data-radix-popper-content-wrapper]";

type VisualViewportLike = Pick<
  VisualViewport,
  "height" | "offsetTop" | "width" | "offsetLeft"
> & EventTarget;

type ViewportEdges = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export function keepFieldWithinVisualViewport(
  element: HTMLElement,
  visualTop: number,
  visualBottom: number,
) {
  const view = element.ownerDocument.defaultView;
  if (!view) return;

  const scrollableAncestors: HTMLElement[] = [];
  let ancestor = element.parentElement;
  while (ancestor) {
    const { overflowY } = view.getComputedStyle(ancestor);
    if (
      /(auto|scroll|overlay)/.test(overflowY)
      && ancestor.scrollHeight > ancestor.clientHeight
    ) {
      scrollableAncestors.push(ancestor);
    }
    ancestor = ancestor.parentElement;
  }

  if (scrollableAncestors.length === 0) {
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    return;
  }

  for (const scrollable of scrollableAncestors) {
    const fieldBounds = element.getBoundingClientRect();
    const scrollBounds = scrollable.getBoundingClientRect();
    const availableTop = Math.max(scrollBounds.top, visualTop);
    const availableBottom = Math.min(scrollBounds.bottom, visualBottom);
    const contextMargin = Math.min(24, Math.max(0, (availableBottom - availableTop) / 4));

    if (fieldBounds.bottom + contextMargin > availableBottom) {
      scrollable.scrollTop += fieldBounds.bottom + contextMargin - availableBottom;
    } else if (fieldBounds.top - contextMargin < availableTop) {
      scrollable.scrollTop -= availableTop - fieldBounds.top + contextMargin;
    }
  }
}

function keepFloatingSurfacesWithinVisualViewport(
  targetDocument: Document,
  visualBounds: ViewportEdges,
  safeArea: ViewportEdges,
) {
  if (typeof targetDocument.querySelectorAll !== "function") return;

  for (const surface of targetDocument.querySelectorAll<HTMLElement>(FLOATING_SURFACE_SELECTOR)) {
    surface.style.setProperty("--app-visual-viewport-shift-x", "0px");
    surface.style.setProperty("--app-visual-viewport-shift-y", "0px");
    const bounds = surface.getBoundingClientRect();
    const availableTop = visualBounds.top + safeArea.top + 8;
    const availableRight = visualBounds.right - safeArea.right - 8;
    const availableBottom = visualBounds.bottom - safeArea.bottom - 8;
    const availableLeft = visualBounds.left + safeArea.left + 8;
    let shiftX = 0;
    let shiftY = 0;

    if (bounds.bottom > availableBottom) {
      shiftY = availableBottom - bounds.bottom;
    }
    if (bounds.top + shiftY < availableTop) {
      shiftY += availableTop - (bounds.top + shiftY);
    }

    if (bounds.right > availableRight) {
      shiftX = availableRight - bounds.right;
    }
    if (bounds.left + shiftX < availableLeft) {
      shiftX += availableLeft - (bounds.left + shiftX);
    }

    surface.style.setProperty("--app-visual-viewport-shift-x", `${Math.round(shiftX)}px`);
    surface.style.setProperty("--app-visual-viewport-shift-y", `${Math.round(shiftY)}px`);
  }
}

function readResolvedSafeArea(root: HTMLElement): ViewportEdges {
  const styles = root.ownerDocument?.defaultView?.getComputedStyle(root);
  const pixels = (value: string | undefined) => {
    const parsed = Number.parseFloat(value ?? "");
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return {
    top: pixels(styles?.scrollPaddingTop),
    right: pixels(styles?.scrollPaddingRight),
    bottom: pixels(styles?.scrollPaddingBottom),
    left: pixels(styles?.scrollPaddingLeft),
  };
}

function clearFloatingSurfaceAdjustments(targetDocument: Document) {
  if (typeof targetDocument.querySelectorAll !== "function") return;
  for (const surface of targetDocument.querySelectorAll<HTMLElement>(FLOATING_SURFACE_SELECTOR)) {
    surface.style.removeProperty("--app-visual-viewport-shift-x");
    surface.style.removeProperty("--app-visual-viewport-shift-y");
  }
}

export type MobileViewportWindow = Pick<
  Window,
  "innerHeight" | "innerWidth" | "requestAnimationFrame" | "cancelAnimationFrame" | "addEventListener" | "removeEventListener"
> & {
  visualViewport: VisualViewportLike | null;
};

export function installMobileViewportBehavior({
  targetWindow = window,
  root = document.documentElement,
  targetDocument = document,
}: {
  targetWindow?: MobileViewportWindow;
  root?: HTMLElement;
  targetDocument?: Document;
} = {}) {
  const viewport = targetWindow.visualViewport;
  let baselineVisualHeight = viewport?.height ?? targetWindow.innerHeight;
  let baselineVisualWidth = viewport?.width ?? targetWindow.innerWidth;
  let frame = 0;

  const update = () => {
    const height = viewport?.height ?? targetWindow.innerHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? targetWindow.innerWidth;
    const offsetLeft = viewport?.offsetLeft ?? 0;
    const widthChanged = Math.abs(width - baselineVisualWidth) > KEYBOARD_THRESHOLD_PX;
    if (widthChanged) {
      baselineVisualHeight = height;
      baselineVisualWidth = width;
    } else {
      baselineVisualHeight = Math.max(baselineVisualHeight, height);
      baselineVisualWidth = Math.max(baselineVisualWidth, width);
    }
    const keyboardOpen = viewport !== null
      && baselineVisualHeight - height > KEYBOARD_THRESHOLD_PX;
    const safeArea = readResolvedSafeArea(root);
    const visualBounds = {
      top: offsetTop,
      right: offsetLeft + width,
      bottom: offsetTop + height,
      left: offsetLeft,
    };

    root.style.setProperty("--app-visual-height", `${Math.round(height)}px`);
    root.style.setProperty("--app-visual-offset-top", `${Math.round(offsetTop)}px`);
    root.style.setProperty("--app-visual-width", `${Math.round(width)}px`);
    root.style.setProperty("--app-visual-offset-left", `${Math.round(offsetLeft)}px`);
    root.toggleAttribute("data-app-keyboard-open", keyboardOpen);
    keepFloatingSurfacesWithinVisualViewport(
      targetDocument,
      visualBounds,
      safeArea,
    );

    if (!keyboardOpen) return;

    const activeElement = targetDocument.activeElement;
    const HTMLElementConstructor = targetDocument.defaultView?.HTMLElement;
    if (
      !HTMLElementConstructor
      || !(activeElement instanceof HTMLElementConstructor)
      || !activeElement.matches(FOCUSABLE_FIELD_SELECTOR)
    ) {
      return;
    }

    keepFieldWithinVisualViewport(
      activeElement,
      visualBounds.top + safeArea.top,
      visualBounds.bottom - safeArea.bottom,
    );
  };

  const scheduleUpdate = () => {
    targetWindow.cancelAnimationFrame(frame);
    frame = targetWindow.requestAnimationFrame(update);
  };

  viewport?.addEventListener("resize", scheduleUpdate);
  viewport?.addEventListener("scroll", scheduleUpdate);
  targetWindow.addEventListener("resize", scheduleUpdate);
  targetDocument.addEventListener("focusin", scheduleUpdate);
  const MutationObserverConstructor = targetDocument.defaultView?.MutationObserver;
  const portalObserver = MutationObserverConstructor && targetDocument.body
    ? new MutationObserverConstructor(scheduleUpdate)
    : null;
  portalObserver?.observe(targetDocument.body, { childList: true });
  scheduleUpdate();

  return () => {
    targetWindow.cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", scheduleUpdate);
    viewport?.removeEventListener("scroll", scheduleUpdate);
    targetWindow.removeEventListener("resize", scheduleUpdate);
    targetDocument.removeEventListener("focusin", scheduleUpdate);
    portalObserver?.disconnect();
    clearFloatingSurfaceAdjustments(targetDocument);
    root.style.removeProperty("--app-visual-height");
    root.style.removeProperty("--app-visual-offset-top");
    root.style.removeProperty("--app-visual-width");
    root.style.removeProperty("--app-visual-offset-left");
    root.removeAttribute("data-app-keyboard-open");
  };
}