"use client";

import { MessageCircle } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import { User } from "@supabase/supabase-js";

export default function FeedbackForm({ user }: { user: User }) {
  const submitFeedback = async (formData: FormData) => {
    const content = formData.get("feedback_input");
    if (!content) return;

    const supabase = createClient();

    const key =
      user.app_metadata.type === "company" ? "company_user_id" : "user_id";

    const { error } = await supabase.from("feedbacks").insert({
      content: content,
      [key]: user.id,
    });

    if (error) {
      toast.error("Some error occured. Please try again later.");
      return;
    }

    toast.success("Feedback submitted succesfully!");
  };
  return (
    <Dialog>
      <DialogTrigger>
        <MessageCircle className="h-5 w-5 text-muted-foreground hover:text-primary transition-colors" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Feedback</DialogTitle>
          <DialogDescription>
            We would love to hear your suggestions
          </DialogDescription>
        </DialogHeader>
        <form action={submitFeedback} className="flex flex-col gap-4">
          <Textarea
            name="feedback_input"
            id="feedback"
            placeholder="How can we improve?"
            className="bg-input"
            required
          />
          <DialogClose asChild>
            <Button type="submit">Submit</Button>
          </DialogClose>
        </form>
      </DialogContent>
    </Dialog>
  );
}
