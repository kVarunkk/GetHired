"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { saveCompanyNotificationSettingsAction } from "@/app/actions/pipeline/save-notification-settings";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Frequency = "off" | "instant" | "daily";

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "daily", label: "Daily digest at 9:00 IST" },
  { value: "instant", label: "As people apply (at most every 15 minutes per job)" },
  { value: "off", label: "Off" },
];

/** Company settings: new-applicant emails and the weekly matches email (PL-REQ-009/010). */
export default function NotificationSettings({
  initial,
}: {
  initial: { notifyNewApplicants: Frequency; notifyWeeklyMatches: boolean };
}) {
  const [settings, setSettings] = useState(initial);

  const save = async (next: typeof settings) => {
    const previous = settings;
    setSettings(next);
    try {
      const result = await saveCompanyNotificationSettingsAction(next);
      if (!result.ok) {
        setSettings(previous);
        toast.error(result.error);
      } else {
        toast.success("Notification settings saved.");
      }
    } catch {
      setSettings(previous);
      toast.error("Couldn't save your settings. Please try again.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label>New applicants</Label>
        <Select
          value={settings.notifyNewApplicants}
          onValueChange={(v) => void save({ ...settings, notifyNewApplicants: v as Frequency })}
        >
          <SelectTrigger className="max-w-md" aria-label="New applicant emails">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <Switch
          id="weekly-matches"
          aria-label="Weekly matches email"
          checked={settings.notifyWeeklyMatches}
          onCheckedChange={(checked) => void save({ ...settings, notifyWeeklyMatches: checked })}
        />
        <Label htmlFor="weekly-matches">
          Weekly email on Mondays with each active job&apos;s new matched candidates
        </Label>
      </div>
    </div>
  );
}
