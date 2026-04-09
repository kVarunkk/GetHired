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
import Link from "next/link";
import { Database } from "@/utils/types/database.types";

interface IinitialPreferences {
  id: string;
  is_promotion_active: boolean;
  is_job_digest_active: boolean;
  is_public: boolean;
}

interface UserOnboardingPersonalizationProps {
  initialPreferences: IinitialPreferences;
  disabled: boolean;
}

export default function UserOnboardingPersonalization({
  initialPreferences,
  disabled,
}: UserOnboardingPersonalizationProps) {
  const [prefs, setPrefs] = useState({
    is_promotion_active: initialPreferences.is_promotion_active,
    is_job_digest_active: initialPreferences.is_job_digest_active,
    is_public: initialPreferences.is_public,
  });

  const [isLoading, setIsLoading] = useState(false);

  const handlePreferenceChange = async (
    key: keyof typeof prefs,
    newValue: boolean,
  ) => {
    const originalValue = prefs[key];

    // Optimistic Update
    setPrefs((prev) => ({ ...prev, [key]: newValue }));
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("user_info")
        .update({
          [key]: newValue,
        } as Database["public"]["Tables"]["user_info"]["Update"])
        .eq("user_id", initialPreferences.id);

      if (error) throw new Error("Update failed");
    } catch {
      // Rollback on failure
      setPrefs((prev) => ({ ...prev, [key]: originalValue }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="item-1" className="border-0">
        <AccordionTrigger className="text-sm font-medium">
          Preferences
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
                checked={prefs.is_job_digest_active}
                disabled={isLoading || disabled}
                onCheckedChange={(checked: boolean) =>
                  handlePreferenceChange("is_job_digest_active", checked)
                }
              />
              <Label htmlFor="job_digest" className="text-sm cursor-pointer">
                Weekly Job Digest: Receive top AI-matched job recommendations
                every week.
              </Label>
              <InfoTooltip
                content={
                  <p>
                    Primary Resume is used to build Job Digest.{" "}
                    <Link href={"/resume"} className="text-blue-500">
                      Change Primary Resume
                    </Link>
                  </p>
                }
              />
            </div>

            {/* Checkbox 2: Promotions */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="promotions"
                checked={prefs.is_promotion_active}
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

            <div className="flex items-center space-x-2">
              <Checkbox
                id="profile_visibility"
                checked={prefs.is_public}
                disabled={isLoading}
                onCheckedChange={(checked: boolean) =>
                  handlePreferenceChange("is_public", checked)
                }
              />
              <Label
                htmlFor="profile_visibility"
                className="text-sm cursor-pointer"
              >
                Public Profile: Allow technical recruiters to find your profile
                on their candidate feed.
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
