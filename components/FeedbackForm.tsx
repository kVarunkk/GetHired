"use client";

import { MessageCircle } from "lucide-react";
import { Button } from "./ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { Textarea } from "./ui/textarea";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import { User } from "@supabase/supabase-js";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import SidebarLabel from "./SidebarLabel";

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

    const isCompany = user.app_metadata.type === "company";

    const { error } = await supabase.from("feedbacks").insert({
      content: content as string,
      ...(isCompany ? { company_user_id: user.id } : { user_id: user.id }),
    });

    if (error) {
      toast.error("Some error occured. Please try again later.");
      return;
    }

    toast.success("Feedback submitted succesfully!");
  };
  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      {isVertical ? (
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <ResponsiveDialogTrigger className="flex items-center w-full px-4 py-2 gap-2 hover:bg-secondary transition-colors rounded-lg overflow-hidden">
              <MessageCircle className="h-4 w-4 shrink-0" />
              <SidebarLabel open={isMenuOpen}>Feedback</SidebarLabel>
            </ResponsiveDialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" hidden={isMenuOpen}>
            <p>Feedback</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        // Horizontal navbar: an icon button the same size as the profile button.
        <ResponsiveDialogTrigger
          aria-label="Feedback"
          className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-secondary transition-colors"
        >
          <MessageCircle className="h-4 w-4" />
        </ResponsiveDialogTrigger>
      )}

      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Feedback</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            We would love to hear your suggestions
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form
          action={(formData) => {
            setIsOpen(false);
            submitFeedback(formData);
          }}
          className="flex min-h-0 flex-col gap-4"
        >
          <ResponsiveDialogBody>
            <Textarea
              name="feedback_input"
              id="feedback"
              placeholder="How can we improve?"
              required
            />
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button type="submit" className="w-full">
              Submit
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
