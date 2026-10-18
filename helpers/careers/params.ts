/** Next's `searchParams` object as URLSearchParams (repeated keys kept). */
export function toSearchParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  return params;
}

/** CP-REQ-013: a short, safe `?ref=` tag (e.g. linkedin, website), lowercased. */
export function readRef(params: URLSearchParams): string | null {
  const ref = params.get("ref")?.trim();
  return ref && /^[A-Za-z0-9_-]{1,40}$/.test(ref) ? ref.toLowerCase() : null;
}
