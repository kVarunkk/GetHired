import { describe, expect, it } from "vitest";
import {
  bannerState,
  EMPTY_DISMISSALS,
  parseDismissals,
  recordDismissal,
  type BannerInput,
} from "./banner-state";

const NOW = Date.parse("2026-11-24T10:00:00Z");
const DAY = 24 * 3600_000;
const BASE: BannerInput = {
  isCompany: false,
  filtersKey: "k1",
  tab: null,
  sortBy: null,
  alertState: "none",
  activeCount: 0,
  dismissed: EMPTY_DISMISSALS,
  now: NOW,
};
const state = (o: Partial<BannerInput>) => bannerState({ ...BASE, ...o });

describe("bannerState (JAT-040)", () => {
  it("offers on an alertable search", () => expect(state({})).toBe("offer"));
  it("is hidden for companies, non-alertable searches, other tabs and AI search", () => {
    expect(state({ isCompany: true })).toBe("hidden");
    expect(state({ filtersKey: null })).toBe("hidden");
    expect(state({ tab: "saved" })).toBe("hidden");
    expect(state({ tab: "all" })).toBe("offer");
    expect(state({ sortBy: "relevance" })).toBe("hidden");
  });
  it("shows already_on for an active alert, even if dismissed", () => {
    expect(
      state({
        alertState: "active",
        dismissed: { ...EMPTY_DISMISSALS, keys: ["k1"] },
      }),
    ).toBe("already_on");
  });
  it("offers resume for a paused alert", () =>
    expect(state({ alertState: "paused" })).toBe("resume"));
  it("says at_cap with 5 active alerts and no match", () => {
    expect(state({ activeCount: 5 })).toBe("at_cap");
    expect(state({ activeCount: 5, alertState: "paused" })).toBe("at_cap");
    expect(state({ activeCount: 4 })).toBe("offer");
  });
  it("hides a dismissed key", () => {
    expect(state({ dismissed: { ...EMPTY_DISMISSALS, keys: ["k1"] } })).toBe(
      "hidden",
    );
    expect(state({ dismissed: { ...EMPTY_DISMISSALS, keys: ["k2"] } })).toBe(
      "offer",
    );
  });
  it("hides everything during the quiet period, until it ends", () => {
    expect(
      state({ dismissed: { ...EMPTY_DISMISSALS, quietUntil: NOW + 1 } }),
    ).toBe("hidden");
    expect(state({ dismissed: { ...EMPTY_DISMISSALS, quietUntil: NOW } })).toBe(
      "offer",
    );
  });
  it("shows created after a create", () =>
    expect(state({ created: true })).toBe("created"));
});

describe("recordDismissal (JAT-040)", () => {
  it("adds the key once", () => {
    const s = recordDismissal(
      recordDismissal(EMPTY_DISMISSALS, "a", NOW),
      "a",
      NOW + 1,
    );
    expect(s.keys).toEqual(["a"]);
  });

  it("keeps at most 50 keys, dropping the oldest", () => {
    let s = EMPTY_DISMISSALS;
    for (let i = 0; i < 55; i++) s = recordDismissal(s, `k${i}`, NOW + i);
    expect(s.keys).toHaveLength(50);
    expect(s.keys[0]).toBe("k5");
    expect(s.keys.at(-1)).toBe("k54");
  });

  it("goes quiet for 30 days after 3 dismissals within 30 days", () => {
    let s = recordDismissal(EMPTY_DISMISSALS, "a", NOW);
    s = recordDismissal(s, "b", NOW + 10 * DAY);
    expect(s.quietUntil).toBeNull();
    s = recordDismissal(s, "c", NOW + 29 * DAY);
    expect(s.quietUntil).toBe(NOW + 29 * DAY + 30 * DAY);
  });

  it("does not go quiet when the first is 31 days old", () => {
    let s = recordDismissal(EMPTY_DISMISSALS, "a", NOW);
    s = recordDismissal(s, "b", NOW + 10 * DAY);
    s = recordDismissal(s, "c", NOW + 31 * DAY);
    expect(s.quietUntil).toBeNull();
  });
});

describe("parseDismissals", () => {
  it("reads missing or corrupt storage as empty", () => {
    expect(parseDismissals(null)).toEqual(EMPTY_DISMISSALS);
    expect(parseDismissals("{nope")).toEqual(EMPTY_DISMISSALS);
    expect(parseDismissals("42")).toEqual(EMPTY_DISMISSALS);
    expect(
      parseDismissals('{"keys":"x","times":[1,"y"],"quietUntil":"z"}'),
    ).toEqual({
      keys: [],
      times: [1],
      quietUntil: null,
    });
  });
  it("round-trips a store", () => {
    const s = recordDismissal(EMPTY_DISMISSALS, "a", NOW);
    expect(parseDismissals(JSON.stringify(s))).toEqual(s);
  });
});
