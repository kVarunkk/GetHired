import { NextRequest } from "next/server";

type BuildRequestOptions = {
  method?: string;
  /** Serialised as JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  searchParams?: Record<string, string>;
  /** Stands in for the client disconnecting (`request.signal`). */
  signal?: AbortSignal;
};

/** Builds a `NextRequest` for calling route handlers directly in tests. */
export function buildRequest(
  path: string,
  { method = "GET", body, headers = {}, searchParams = {}, signal }: BuildRequestOptions = {},
) {
  const url = new URL(path, "http://localhost:3000");
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  return new NextRequest(url, {
    method,
    headers:
      body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}
