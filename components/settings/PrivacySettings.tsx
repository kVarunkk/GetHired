"use client";

import { useState } from "react";
import ProfileVisibilitySetting from "@/components/ProfileVisibilitySetting";
import OutreachPreferences, {
  type BlockedCompany,
} from "@/components/OutreachPreferences";

/**
 * Profile visibility and outreach on /settings. They share `isPublic`:
 * outreach is only possible while the profile is public, so hiding the
 * profile disables the outreach switch straight away.
 */
export default function PrivacySettings({
  initialIsPublic,
  initialAcceptsOutreach,
  initialBlocked,
}: {
  initialIsPublic: boolean;
  initialAcceptsOutreach: boolean;
  initialBlocked: BlockedCompany[];
}) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);

  return (
    <div className="flex flex-col divide-y">
      <div className="pb-5">
        <ProfileVisibilitySetting
          initialIsPublic={initialIsPublic}
          onChange={setIsPublic}
        />
      </div>
      <div className="pt-5">
        <OutreachPreferences
          initialAcceptsOutreach={initialAcceptsOutreach}
          isPublic={isPublic}
          initialBlocked={initialBlocked}
        />
      </div>
    </div>
  );
}
