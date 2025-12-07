"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "./ui/button";
import toast from "react-hot-toast";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Loader2 } from "lucide-react";

export default function CreditDepositDialog({
  userId,
  pendingDialogEmails,
}: {
  userId: string;
  pendingDialogEmails: string[];
}) {
  const [openDialog, setOpenDialog] = useState(true);
  const [loading, setLoading] = useState(false);

  const updateInvitation = async () => {
    try {
      setLoading(true);
      const supabase = createClient();
      const { error } = await supabase
        .from("invitations")
        .update({
          isDialogShown: true,
        })
        .eq("referrer_user_id", userId)
        .in("invited_email", pendingDialogEmails);
      if (error) throw error;
    } catch {
      toast.error("Some error occured while updating the invitations.");
    } finally {
      setLoading(false);
      setOpenDialog(false);
    }
  };

  return (
    <AlertDialog open={openDialog} onOpenChange={setOpenDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            🎉 Congratulations! You just earned{" "}
            {pendingDialogEmails.length * 10} AI credits
          </AlertDialogTitle>
          <AlertDialogDescription>
            {/* winner, hofwef, fwefwe and fewfwe */}
            {pendingDialogEmails.map((each, i) => (
              <span key={each}>
                {i === 0
                  ? ""
                  : i === pendingDialogEmails.length - 1
                    ? " and "
                    : ", "}
                {each}
              </span>
            ))}{" "}
            accepted your invite.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={updateInvitation} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : ""}
            Dismiss
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
