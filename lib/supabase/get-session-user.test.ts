import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./server";
import { getSessionUser } from "./get-session-user";

vi.mock("./server", () => ({ createClient: vi.fn() }));

const getClaims = vi.fn();
const getUser = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createClient).mockResolvedValue({ auth: { getClaims, getUser } } as never);
});

describe("getSessionUser", () => {
  it("reads the user from the verified token, without asking the Auth server", async () => {
    getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: "u1",
          email: "a@example.com",
          app_metadata: { type: "applicant" },
          user_metadata: { full_name: "Ada" },
        },
      },
      error: null,
    });

    expect(await getSessionUser()).toEqual({
      id: "u1",
      email: "a@example.com",
      app_metadata: { type: "applicant" },
      user_metadata: { full_name: "Ada" },
    });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("is signed out with no session, and asks nothing more", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    expect(await getSessionUser()).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it.each([
    ["an error", () => getClaims.mockResolvedValue({ data: null, error: new Error("bad token") })],
    ["a throw", () => getClaims.mockRejectedValue(new Error("no keys"))],
  ])("leaves it to the Auth server after %s", async (_name, arrange) => {
    arrange();
    getUser.mockResolvedValue({ data: { user: null } });

    expect(await getSessionUser()).toBeNull();
    expect(getUser).toHaveBeenCalledOnce();
  });
});
