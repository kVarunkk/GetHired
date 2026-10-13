import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { canonicalizeLocations, expandLocations } from "./aliases";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

// A slice of the real table: canonical names are mixed case, aliases too.
const ALIASES = [
  { alias: "bangalore", canonical_name: "Bengaluru" },
  { alias: "Bengaluru, Karnataka", canonical_name: "Bengaluru" },
  { alias: "gurgaon", canonical_name: "gurugram" },
  { alias: "nyc", canonical_name: "New York" },
  { alias: "new york city", canonical_name: "New York" },
];

let service: SupabaseMock;

beforeEach(() => {
  service = createSupabaseMock();
  service.queue("location_aliases", { data: ALIASES, error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
});

const sorted = (values: string[]) => [...values].sort();

describe("expandLocations (for job filters)", () => {
  it("searches an alias's whole group, so 'Bangalore' also finds jobs stored as 'bengaluru'", async () => {
    expect(sorted(await expandLocations(["Bangalore"]))).toEqual(
      sorted(["bangalore", "bengaluru", "bengaluru, karnataka"]),
    );
  });

  it("expands a canonical name to its aliases too", async () => {
    expect(sorted(await expandLocations(["New York"]))).toEqual(
      sorted(["new york", "nyc", "new york city"]),
    );
  });

  it("matches case-insensitively and trims", async () => {
    expect(sorted(await expandLocations(["  GURGAON "]))).toEqual(["gurgaon", "gurugram"]);
  });

  it("passes unknown names and Remote through, lowercased and de-duplicated", async () => {
    expect(sorted(await expandLocations(["Pune", "Remote", "pune"]))).toEqual(["pune", "remote"]);
  });

  it("reads the alias table with the service-role client (RLS hides it from users)", async () => {
    await expandLocations(["Pune"]);

    expect(service.callsFor("location_aliases")[0].chain).toEqual([
      { method: "select", args: ["alias, canonical_name"] },
    ]);
  });

  it("makes no query for an empty list", async () => {
    expect(await expandLocations([])).toEqual([]);
    expect(service.calls).toEqual([]);
  });

  it("falls back to the plain names when the alias table can't be read", async () => {
    service = createSupabaseMock();
    service.queue("location_aliases", { data: null, error: new Error("db down") });
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client);

    expect(await expandLocations(["Bangalore"])).toEqual(["bangalore"]);
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.objectContaining({ flow: "location_aliases" }) }),
    );
  });
});

describe("canonicalizeLocations (for saved profiles)", () => {
  it("replaces aliases with their canonical name and keeps unknown names as typed", async () => {
    expect(await canonicalizeLocations(["Bangalore", "NYC", " Pune "])).toEqual([
      "Bengaluru",
      "New York",
      "Pune",
    ]);
  });

  it("de-duplicates names that resolve to the same place", async () => {
    expect(await canonicalizeLocations(["Bangalore", "Bengaluru", "bengaluru"])).toEqual([
      "Bengaluru",
    ]);
  });

  it("keeps a canonical name as stored", async () => {
    expect(await canonicalizeLocations(["Gurgaon"])).toEqual(["gurugram"]);
  });
});
