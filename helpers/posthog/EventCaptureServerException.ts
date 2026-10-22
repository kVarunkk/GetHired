import { captureServerException } from "@/helpers/posthog/report-error";

export async function eventCaptureServerException({
  error,
  distinctId,
  properties = {},
}: {
  error: unknown;
  distinctId?: string;
  properties?: Record<string, unknown>;
}) {
  await captureServerException(error, properties, distinctId);
}
