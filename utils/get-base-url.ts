import { headers } from "next/headers";

export async function getBaseUrl() {
  const headersList = await headers();
  const host = headersList.get("host");
  const forwardedProto = headersList.get("x-forwarded-proto");

  const protocol =
    forwardedProto ??
    (host?.includes("localhost") || host?.includes("127.0.0.1")
      ? "http"
      : "https");

  return `${protocol}://${host}`;
}
