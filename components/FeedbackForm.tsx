"use client";

import { MessageCircle } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
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
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function FeedbackForm({
  user,
  isMenuOpen,
  isVertical = false,
}: {
  user: User;
  isMenuOpen: boolean;
  isVertical?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
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
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {isVertical ? (
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <DialogTrigger
              className={cn(
                "flex items-center w-full p-2 gap-2 hover:bg-secondary transition-all rounded-lg",
                isMenuOpen ? "justify-start" : "justify-center"
              )}
            >
              <MessageCircle className="h-4 w-4" />
              {isMenuOpen ? <span className=" text-sm">Feedback</span> : ""}
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" hidden={isMenuOpen}>
            <p>Feedback</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <DialogTrigger
          className={cn(
            "flex items-center w-full p-2 gap-2 hover:bg-secondary transition-all rounded-lg",
            isMenuOpen ? "justify-start" : "justify-center"
          )}
        >
          <MessageCircle className="h-4 w-4" />
          {isMenuOpen ? <span className=" text-sm">Feedback</span> : ""}
        </DialogTrigger>
      )}

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Feedback</DialogTitle>
          <DialogDescription>
            We would love to hear your suggestions
          </DialogDescription>
        </DialogHeader>
        <form
          action={(formData) => {
            setIsOpen(false);
            submitFeedback(formData);
          }}
          className="flex flex-col gap-4"
        >
          <Textarea
            name="feedback_input"
            id="feedback"
            placeholder="How can we improve?"
            className="bg-input"
            required
          />
          {/* <DialogClose asChild> */}
          <Button type="submit">Submit</Button>
          {/* </DialogClose> */}
        </form>
      </DialogContent>
    </Dialog>
  );
}
