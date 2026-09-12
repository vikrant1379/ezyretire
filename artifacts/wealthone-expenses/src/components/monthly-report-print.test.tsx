import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ReactElement } from "react";
import { ToastViewport } from "@workspace/wealthone-design-system/components/ui/toast";

test("the rendered toast viewport is excluded from monthly report printing", async () => {
  const viewportElement = (
    ToastViewport as unknown as {
      render: (
        props: Record<string, unknown>,
        ref: null,
      ) => ReactElement<Record<string, unknown>>;
    }
  ).render({ "aria-label": "Notifications" }, null);
  const stylesheet = await readFile(
    new URL("../index.css", import.meta.url),
    "utf8",
  );

  assert.equal(viewportElement.props["data-app-toast-viewport"], "true");
  assert.match(
    stylesheet,
    /body\[data-monthly-report-print="true"\] \[data-app-toast-viewport="true"\]/,
  );
});