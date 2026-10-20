"use client";

import { useCallback, useState } from "react";
import UpgradeDialog from "@/components/billing/UpgradeDialog";
import {
  entitlementFromActionResult,
  isEntitlementPayload,
  type EntitlementPayload,
} from "@/helpers/billing/errors";

/**
 * Opens the shared UpgradeDialog for a failed entitlement check (BL-REQ-020).
 *
 *   const { handle, dialog } = useEntitlementError();
 *   const result = await someAction();
 *   if (await handle(result)) return;   // the dialog explains it
 *   ...render {dialog} somewhere in the component.
 *
 * `handle` takes a server action result (`{ error: { code: "entitlement" } }`)
 * or a fetch `Response` (402). It returns false for anything else, so the
 * caller falls back to its own error handling.
 */
export function useEntitlementError({ onUseCredits }: { onUseCredits?: () => void } = {}) {
  const [payload, setPayload] = useState<EntitlementPayload | null>(null);
  const [open, setOpen] = useState(false);

  const show = useCallback((p: EntitlementPayload) => {
    setPayload(p);
    setOpen(true);
  }, []);

  const handle = useCallback(
    async (result: unknown): Promise<boolean> => {
      if (typeof Response !== "undefined" && result instanceof Response) {
        if (result.status !== 402) return false;
        const body = await result.clone().json().catch(() => null);
        if (!isEntitlementPayload(body)) return false;
        show(body);
        return true;
      }
      const p = entitlementFromActionResult(result);
      if (!p) return false;
      show(p);
      return true;
    },
    [show],
  );

  const dialog = (
    <UpgradeDialog payload={payload} open={open} onOpenChange={setOpen} onUseCredits={onUseCredits} />
  );

  return { handle, show, dialog };
}
