"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { withdrawOutreachAction } from "@/app/actions/outreach/withdraw-outreach";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";

/** Withdraws an unanswered outreach from the company's Outreach list. */
export default function WithdrawOutreachButton({ outreachId }: { outreachId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Button size="sm" variant="destructive-ghost" onClick={() => setConfirming(true)}>
        Withdraw
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Withdraw this message?"
        description="The candidate is told you withdrew it and can no longer reply. This can't be undone."
        confirmLabel="Withdraw"
        onConfirm={async () => {
          const result = await withdrawOutreachAction({ outreachId });
          if (!result.ok) {
            toast.error(result.error);
            return false;
          }
          toast.success("Withdrawn.");
          router.refresh();
        }}
      />
    </>
  );
}
