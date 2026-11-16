import { describe, expect, it, vi } from "vitest";

const real = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: real }));

import posthog, { loadPostHog } from "./client";

describe("posthog client", () => {
  it("queues calls made before load and replays them in order after init", async () => {
    posthog.identify("u1", { email: "a@b.c" });
    posthog.capture("billing_pricing_viewed");
    expect(real.capture).not.toHaveBeenCalled();

    await loadPostHog();

    expect(real.init).toHaveBeenCalledTimes(1);
    expect(real.identify).toHaveBeenCalledWith("u1", { email: "a@b.c" });
    expect(real.capture).toHaveBeenCalledWith("billing_pricing_viewed");
    expect(real.init.mock.invocationCallOrder[0]).toBeLessThan(real.identify.mock.invocationCallOrder[0]);
    expect(real.identify.mock.invocationCallOrder[0]).toBeLessThan(real.capture.mock.invocationCallOrder[0]);

    posthog.capture("job_search_performed");
    expect(real.capture).toHaveBeenLastCalledWith("job_search_performed");

    await loadPostHog();
    expect(real.init).toHaveBeenCalledTimes(1);
  });

  it("reports exceptions only from production builds", async () => {
    await loadPostHog();
    const error = new Error("boom");

    vi.stubEnv("NODE_ENV", "development");
    posthog.captureException(error);
    expect(real.captureException).not.toHaveBeenCalled();

    vi.stubEnv("NODE_ENV", "production");
    posthog.captureException(error);
    expect(real.captureException).toHaveBeenCalledWith(error);
    vi.unstubAllEnvs();
  });
});
