"use client";

import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { setEmailPreferenceAction } from "@/app/actions/user/set-email-preference";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type EmailPreferenceKey = "is_job_digest_active" | "is_promotion_active";

/** The applicant's email subscriptions on /settings. */
export default function EmailPreferences({
  initialJobDigest,
  initialPromotions,
}: {
  initialJobDigest: boolean;
  initialPromotions: boolean;
}) {
  const [prefs, setPrefs] = useState<Record<EmailPreferenceKey, boolean>>({
    is_job_digest_active: initialJobDigest,
    is_promotion_active: initialPromotions,
  });
  const [saving, setSaving] = useState<EmailPreferenceKey | null>(null);

  const handleChange = async (key: EmailPreferenceKey, next: boolean) => {
    const previous = prefs[key];
    setPrefs((current) => ({ ...current, [key]: next }));
    setSaving(key);
    try {
      const result = await setEmailPreferenceAction({ key, value: next });
      if (!result.ok) throw new Error(result.error);
    } catch {
      setPrefs((current) => ({ ...current, [key]: previous }));
      toast.error("Couldn't save your preference. Please try again.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col divide-y">
      <div className="flex items-start justify-between gap-4 pb-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="settings_job_digest" className="text-sm font-medium">
            Job digest
          </Label>
          <p
            id="settings_job_digest_details"
            className="text-sm text-muted-foreground"
          >
            Top AI-matched job recommendations every 3 days, built from your{" "}
            <Link
              href="/resume"
              className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-brand"
            >
              primary resume
            </Link>
            .
          </p>
        </div>
        <Switch
          id="settings_job_digest"
          aria-describedby="settings_job_digest_details"
          checked={prefs.is_job_digest_active}
          disabled={saving === "is_job_digest_active"}
          onCheckedChange={(next) => handleChange("is_job_digest_active", next)}
        />
      </div>
      <div className="flex items-start justify-between gap-4 pt-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="settings_promotions" className="text-sm font-medium">
            Product updates
          </Label>
          <p
            id="settings_promotions_details"
            className="text-sm text-muted-foreground"
          >
            Occasional news, feature updates and special offers.
          </p>
        </div>
        <Switch
          id="settings_promotions"
          aria-describedby="settings_promotions_details"
          checked={prefs.is_promotion_active}
          disabled={saving === "is_promotion_active"}
          onCheckedChange={(next) => handleChange("is_promotion_active", next)}
        />
      </div>
    </div>
  );
}
