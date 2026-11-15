"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { saveCompanyTimeZoneAction } from "@/app/actions/company/save-company-time-zone";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { browserTimeZone, timeZoneOptions } from "@/helpers/companies/time-zone";

/**
 * Company settings: the company's time zone (IVT-024, D21), the default for
 * scheduling. With none saved yet it offers the browser's zone.
 */
export default function TimeZoneForm({ initial }: { initial: string | null }) {
  const [zone, setZone] = useState(() => initial ?? browserTimeZone() ?? "UTC");
  const [isSaving, setIsSaving] = useState(false);
  const options = useMemo(() => timeZoneOptions(zone), [zone]);

  const save = async () => {
    setIsSaving(true);
    try {
      const result = await saveCompanyTimeZoneAction({ timeZone: zone });
      if (result.ok) toast.success("Time zone saved.");
      else toast.error(result.error);
    } catch {
      toast.error("Couldn't save the time zone. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={zone} onValueChange={setZone}>
        <SelectTrigger aria-label="Time zone" className="w-full max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((z) => (
            <SelectItem key={z} value={z}>
              {z.replaceAll("_", " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button disabled={isSaving || zone === initial} onClick={() => void save()}>
        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save time zone
      </Button>
    </div>
  );
}
