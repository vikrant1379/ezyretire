import assert from "node:assert/strict";
import test from "node:test";
import type { ReactElement } from "react";
import { VaultDownloadButton } from "../pages/protection.tsx";

test("vault download is wired as a keyboard-accessible button and reports failures", async () => {
  const failure = new Error("download unavailable");
  let downloadedName = "";
  let reported: Error | undefined;
  const action = VaultDownloadButton({
    document: { id: "document-1", name: "Original name.pdf" },
    download: async (document) => {
      downloadedName = document.name;
      throw failure;
    },
    onError: (error) => {
      reported = error;
    },
  }) as ReactElement<Record<string, any>>;

  assert.notEqual(action.props.asChild, true);
  assert.equal(action.props["data-testid"], "button-download-vault-document-1");
  action.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(downloadedName, "Original name.pdf");
  assert.equal(reported, failure);
});