"use client";

import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { createClient } from "@/lib/supabase/client";
import InfoTooltip from "./InfoTooltip";

interface IinitialPreferences {
  id: string;
  is_promotion_active: boolean;
  is_job_digest_active: boolean;
}

interface UserOnboardingPersonalizationProps {
  initialPreferences: IinitialPreferences;
  disabled: boolean;
}

export default function UserOnboardingPersonalization({
  initialPreferences,
  disabled,
}: UserOnboardingPersonalizationProps) {
  const [promoActive, setPromoActive] = useState(
    initialPreferences.is_promotion_active
  );
  const [digestActive, setDigestActive] = useState(
    initialPreferences.is_job_digest_active
  );

  const [isLoading, setIsLoading] = useState(false);

  const handlePreferenceChange = async (
    key: "is_promotion_active" | "is_job_digest_active",
    newValue: boolean
  ) => {
    const originalValue =
      key === "is_promotion_active" ? promoActive : digestActive;

    if (key === "is_promotion_active") {
      setPromoActive(newValue);
    } else {
      setDigestActive(newValue);
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      const updates = { [key]: newValue };

      const { error } = await supabase
        .from("user_info")
        .update(updates)
        .eq("user_id", initialPreferences.id);

      if (error) {
        throw new Error(error.message);
      }
    } catch {
      if (key === "is_promotion_active") {
        setPromoActive(originalValue);
      } else {
        setDigestActive(originalValue);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="item-1" className="border-0">
        <AccordionTrigger className="text-sm font-medium">
          Email Preferences
        </AccordionTrigger>
        <AccordionContent>
          <div className="flex flex-col space-y-4">
            <p className="text-sm text-muted-foreground">
              Help us tailor your inbox experience by managing your
              subscriptions below.
            </p>

            {/* Checkbox 1: Job Digest */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="job_digest"
                checked={digestActive}
                disabled={isLoading || disabled}
                onCheckedChange={(checked: boolean) =>
                  handlePreferenceChange("is_job_digest_active", checked)
                }
              />
              <Label htmlFor="job_digest" className="text-sm cursor-pointer">
                Weekly Job Digest: Receive top AI-matched job recommendations
                every week.
              </Label>
              <InfoTooltip content="Will only work if profile is completed." />
            </div>

            {/* Checkbox 2: Promotions */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="promotions"
                checked={promoActive}
                disabled={isLoading || disabled}
                onCheckedChange={(checked: boolean) =>
                  handlePreferenceChange("is_promotion_active", checked)
                }
              />
              <Label htmlFor="promotions" className="text-sm cursor-pointer">
                Promotional Emails: Receive occasional news, feature updates,
                and special offers.
              </Label>
            </div>

            {isLoading && (
              <p className="text-xs text-blue-500 mt-4">
                Saving preferences...
              </p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
