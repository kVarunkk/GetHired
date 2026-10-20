"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import {
  setOutreachPreferencesAction,
  unblockCompanyAction,
} from "@/app/actions/outreach/set-outreach-preferences";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

export type BlockedCompany = { id: string; name: string | null };

/**
 * The applicant's outreach settings on /settings (OR-REQ-012): whether
 * companies may message them, and the companies they blocked.
 */
export default function OutreachPreferences({
  initialAcceptsOutreach,
  isPublic,
  initialBlocked,
}: {
  initialAcceptsOutreach: boolean;
  isPublic: boolean;
  initialBlocked: BlockedCompany[];
}) {
  const [accepts, setAccepts] = useState(initialAcceptsOutreach);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(initialBlocked);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const handleChange = async (next: boolean) => {
    const previous = accepts;
    setAccepts(next);
    setSaving(true);
    const result = await setOutreachPreferencesAction({ acceptsOutreach: next });
    setSaving(false);
    if (!result.ok) {
      setAccepts(previous);
      toast.error(result.error);
      return;
    }
    toast.success(next ? "Companies can message you." : "Companies can no longer message you.");
  };

  const unblock = async (company: BlockedCompany) => {
    setUnblocking(company.id);
    const result = await unblockCompanyAction({ companyId: company.id });
    setUnblocking(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setBlocked((list) => list.filter((c) => c.id !== company.id));
    toast.success(`${company.name ?? "The company"} is unblocked.`);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="settings_accept_outreach" className="text-sm font-medium">
          Accept outreach
        </Label>
        <Switch
          id="settings_accept_outreach"
          aria-describedby="settings_accept_outreach_details"
          checked={isPublic && accepts}
          disabled={!isPublic || saving}
          onCheckedChange={handleChange}
        />
      </div>
      <p id="settings_accept_outreach_details" className="text-sm text-muted-foreground">
        {isPublic
          ? "Companies that find your profile can message you here. You answer on GetHired, and your contact details are shared only if you say you're interested."
          : "Your profile is hidden, so companies can't find or message you. Make it public to receive outreach."}
      </p>

      {blocked.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Blocked companies</p>
          <ul className="divide-y rounded-lg border">
            {blocked.map((company) => (
              <li key={company.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{company.name ?? "A company"}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={unblocking === company.id}
                  onClick={() => unblock(company)}
                  aria-label={`Unblock ${company.name ?? "this company"}`}
                >
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
