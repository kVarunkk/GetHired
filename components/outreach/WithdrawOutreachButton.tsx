"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { withdrawOutreachAction } from "@/app/actions/outreach/withdraw-outreach";
import { Button } from "@/components/ui/button";

/** Withdraws an unanswered outreach from the company's Outreach list. */
export default function WithdrawOutreachButton({ outreachId }: { outreachId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await withdrawOutreachAction({ outreachId });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Withdrawn.");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      Withdraw
    </Button>
  );
}
