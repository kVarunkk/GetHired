import Link from "next/link";
import { BellRing, BellOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { JobAlert } from "@/helpers/job-alerts/alerts";
import { JOB_ALERTS_SETTINGS_PATH } from "@/helpers/job-alerts/paths";

const SHOWN = 3;

/** The user's job alerts, on ones first, with a way to manage them. Null alerts (a failed read) hide the card. */
export default function JobAlertsCard({ alerts }: { alerts: JobAlert[] | null }) {
  if (alerts === null) return null;
  const sorted = [...alerts].sort((a, b) => Number(b.on) - Number(a.on));

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Job alerts</h2>
            <p className="text-sm text-muted-foreground">
              {alerts.length === 0 ? "New jobs for your searches, by email." : `${alerts.filter((a) => a.on).length} on`}
            </p>
          </div>
          {alerts.length > 0 && (
            <Link className="text-sm font-medium text-muted-foreground hover:text-foreground" href={JOB_ALERTS_SETTINGS_PATH}>
              Manage
            </Link>
          )}
        </div>

        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Search on{" "}
            <Link className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground" href="/jobs">
              Jobs
            </Link>
            , then choose <span className="font-medium text-foreground">Create alert</span> to get new matches by email.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sorted.slice(0, SHOWN).map((alert) => {
              const Icon = alert.on ? BellRing : BellOff;
              return (
                <li key={alert.id}>
                  <Link
                    href={alert.url}
                    className="group -mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate text-sm font-medium underline-offset-4 group-hover:underline">{alert.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {alert.on ? (alert.frequency === "daily" ? "Daily" : "Weekly") : "Paused"}
                    </span>
                  </Link>
                </li>
              );
            })}
            {alerts.length > SHOWN && (
              <li className="text-xs text-muted-foreground">and {alerts.length - SHOWN} more</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
