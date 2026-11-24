import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PauseJobAlert from "@/components/job-alerts/PauseJobAlert";
import { loadAlertForPause } from "@/helpers/job-alerts/pause";
import { JOB_ALERTS_SETTINGS_PATH } from "@/helpers/job-alerts/paths";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pause job alert",
  robots: { index: false, follow: false },
};

/**
 * JA-REQ-036, public: the "Pause this alert" link in a job alert email. The
 * signed token names the alert; a button (not the link itself) pauses it, so
 * a mail scanner opening the link doesn't.
 */
export default async function PauseJobAlertPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const alert = await loadAlertForPause(token);
  if (!alert) notFound();

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Pause job alert</h1>
      {alert.on ? (
        <>
          <p className="text-sm text-muted-foreground">
            Pause alerts for <span className="font-medium text-foreground">{alert.name}</span>? We&apos;ll stop
            emailing you new jobs for this search. You can turn it back on in Settings.
          </p>
          <PauseJobAlert token={token} />
        </>
      ) : (
        <p role="status" className="text-sm">
          Alerts for <span className="font-medium">{alert.name}</span> are paused. Turn them back on in{" "}
          <Link href={JOB_ALERTS_SETTINGS_PATH} className="underline underline-offset-4">
            Settings
          </Link>
          .
        </p>
      )}
    </main>
  );
}
