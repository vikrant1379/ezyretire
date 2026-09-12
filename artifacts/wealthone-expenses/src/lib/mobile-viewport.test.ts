import assert from "node:assert/strict";
import test from "node:test";
import {
  installMobileViewportBehavior,
  keepFieldWithinVisualViewport,
  type MobileViewportWindow,
} from "./mobile-viewport.ts";

class MockVisualViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  width = 390;
  offsetLeft = 0;
}

test("tracks keyboard-sized visual viewport changes and restores root state", () => {
  const viewport = new MockVisualViewport();
  const properties = new Map<string, string>();
  const attributes = new Set<string>();
  const root = {
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
    toggleAttribute: (name: string, force: boolean) => {
      if (force) attributes.add(name);
      else attributes.delete(name);
      return force;
    },
    removeAttribute: (name: string) => attributes.delete(name),
  } as unknown as HTMLElement;
  const targetDocument = Object.assign(new EventTarget(), {
    activeElement: null,
    defaultView: null,
    querySelectorAll: () => [],
  }) as unknown as Document;
  const targetWindow = Object.assign(new EventTarget(), {
    innerHeight: 844,
    innerWidth: 390,
    visualViewport: viewport,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => undefined,
  }) as MobileViewportWindow;

  const cleanup = installMobileViewportBehavior({ targetWindow, root, targetDocument });

  assert.equal(properties.get("--app-visual-height"), "844px");
  assert.equal(attributes.has("data-app-keyboard-open"), false);

  viewport.height = 430;
  viewport.offsetTop = 8;
  viewport.dispatchEvent(new Event("resize"));

  assert.equal(properties.get("--app-visual-height"), "430px");
  assert.equal(properties.get("--app-visual-offset-top"), "8px");
  assert.equal(properties.get("--app-visual-width"), "390px");
  assert.equal(properties.get("--app-visual-offset-left"), "0px");
  assert.equal(attributes.has("data-app-keyboard-open"), true);

  viewport.height = 844;
  viewport.offsetTop = 0;
  viewport.dispatchEvent(new Event("resize"));

  assert.equal(attributes.has("data-app-keyboard-open"), false);

  cleanup();
  assert.equal(properties.has("--app-visual-height"), false);
  assert.equal(properties.has("--app-visual-offset-top"), false);
  assert.equal(properties.has("--app-visual-width"), false);
  assert.equal(properties.has("--app-visual-offset-left"), false);
  assert.equal(attributes.has("data-app-keyboard-open"), false);
});

test("scrolls the nearest form scroller until a late field and context fit", () => {
  const scrollable = {
    scrollTop: 0,
    scrollHeight: 800,
    clientHeight: 300,
    parentElement: null,
    getBoundingClientRect: () => ({ top: 100, bottom: 400 }),
  };
  const view = {
    getComputedStyle: () => ({ overflowY: "auto" }),
  };
  const field = {
    parentElement: scrollable,
    ownerDocument: { defaultView: view },
    getBoundingClientRect: () => ({
      top: 620 - scrollable.scrollTop,
      bottom: 660 - scrollable.scrollTop,
    }),
  };

  keepFieldWithinVisualViewport(field as unknown as HTMLElement, 8, 438);

  assert.equal(scrollable.scrollTop, 284);
  assert.equal(field.getBoundingClientRect().bottom, 376);
});