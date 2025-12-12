"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import InfoTooltip from "./InfoTooltip";
import { useState } from "react";
import toast from "react-hot-toast";
import { sendInviteEmail } from "@/app/actions/send-invite-credit-email";
import { User } from "@supabase/supabase-js";

export default function RechargeCredits({
  user,
  invitationsCount,
}: {
  user: User;
  invitationsCount: number;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);

  const inviteUser = async (formData: FormData) => {
    setLoading(true);
    setError(null);

    if (!user) {
      setError("You must be logged in to invite users.");
      setLoading(false);
      return;
    }

    try {
      const invitedEmail = formData.get("user_email")?.toString()?.trim();

      if (!invitedEmail)
        throw new Error("Please enter a valid email to invite.");

      const result = await sendInviteEmail(invitedEmail, user.id); // Call Server Action

      if (result.success) {
        toast.success(
          "Invitation sent! You will earn 10 credits when " +
            invitedEmail +
            " signs up."
        );
        setError(null);
        setOpenDialog(false);
      } else {
        throw new Error(result.error);
      }
    } catch (e) {
      const errorMessage = (e as Error).message;
      setError(errorMessage);
      toast.error(`Invite failed: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={openDialog} onOpenChange={setOpenDialog}>
      <DialogTrigger asChild>
        <Button>
          Recharge Credits <ArrowRight className="w-4 h-4" />
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recharge AI Credits</DialogTitle>
          <DialogDescription>
            <span className="inline-flex  items-center">
              Invite Friends{" "}
              <InfoTooltip content={"Earn 10 credits per Invite"} />
            </span>
            or Buy AI Credits (coming soon) for uninterrupted use of AI
            features. {10 - invitationsCount} invitations remaining for this
            week.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              inviteUser(formData);
            }}
            className="flex flex-col gap-3"
          >
            <Input
              name="user_email"
              type="email"
              placeholder="email@example.com"
              className="bg-input"
              required
              disabled={loading}
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}

            <Button disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin " />}
              Invite
            </Button>
          </form>
          <div className="text-center text-muted-foreground">OR</div>
          <Button type="button" disabled>
            Buy AI Credits (coming soon)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
