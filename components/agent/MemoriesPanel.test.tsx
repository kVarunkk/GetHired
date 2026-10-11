import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemoriesPanel from "./MemoriesPanel";

const MEMORIES = [
  { id: "m1", content: "Avoid crypto companies", category: "preference", source_session_id: null, created_at: "c", updated_at: "u" },
  { id: "m2", content: "Interviewing at Stripe", category: "fact", source_session_id: null, created_at: "c", updated_at: "u" },
];

let fetchMock: ReturnType<typeof vi.fn>;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (!init?.method) return json({ memories: MEMORIES });
    if (init.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      return json({ memory: { ...MEMORIES[0], ...body } });
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const open = async () => {
  render(<MemoriesPanel />);
  await userEvent.click(screen.getByRole("button", { name: "Memories" }));
  return screen.findByRole("dialog");
};

describe("MemoriesPanel", () => {
  it("loads memories grouped by category when opened", async () => {
    const dialog = await open();

    expect(fetchMock).toHaveBeenCalledWith("/api/agent/memories");
    expect(await within(dialog).findByText("Avoid crypto companies")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Facts" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "Goals" })).not.toBeInTheDocument();
  });

  describe("loading", () => {
    /** A memories request the test finishes when it chooses. */
    function deferredLoad() {
      let finish!: (body: unknown, status?: number) => void;
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            finish = (body, status = 200) =>
              resolve(new Response(JSON.stringify(body), { status }));
          }),
      );
      return (body: unknown, status?: number) => finish(body, status);
    }

    const loader = (dialog: HTMLElement) =>
      within(dialog).queryByRole("status", { name: "Loading memories" });

    it("shows a loader until the memories arrive", async () => {
      const finish = deferredLoad();
      const dialog = await open();

      expect(loader(dialog)).toBeInTheDocument();
      expect(within(dialog).queryByText(/No memories yet/)).not.toBeInTheDocument();

      finish({ memories: MEMORIES });

      expect(await within(dialog).findByText("Avoid crypto companies")).toBeInTheDocument();
      expect(loader(dialog)).not.toBeInTheDocument();
    });

    it("replaces the loader with the error when loading fails", async () => {
      const finish = deferredLoad();
      const dialog = await open();

      finish({ error: "Couldn't load memories." }, 500);

      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn't load memories.");
      expect(loader(dialog)).not.toBeInTheDocument();
    });

    it("keeps the list on screen while refreshing on reopen", async () => {
      const dialog = await open();
      await within(dialog).findByText("Avoid crypto companies");
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      deferredLoad();
      await userEvent.click(screen.getByRole("button", { name: "Memories" }));
      const reopened = await screen.findByRole("dialog");

      expect(within(reopened).getByText("Avoid crypto companies")).toBeInTheDocument();
      expect(loader(reopened)).not.toBeInTheDocument();
    });
  });

  it("shows an empty state", async () => {
    fetchMock.mockImplementation(() => json({ memories: [] }));
    const dialog = await open();

    expect(await within(dialog).findByText(/No memories yet/)).toBeInTheDocument();
  });

  it("edits a memory", async () => {
    const dialog = await open();
    await within(dialog).findByText("Avoid crypto companies");

    await userEvent.click(within(dialog).getByRole("button", { name: "Edit: Avoid crypto companies" }));
    const editor = within(dialog).getByRole("textbox", { name: "Memory" });
    await userEvent.clear(editor);
    await userEvent.type(editor, "Crypto is fine now");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/agent/memories/m1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Crypto is fine now" }),
    });
    expect(await within(dialog).findByText("Crypto is fine now")).toBeInTheDocument();
  });

  it("deletes a memory", async () => {
    const dialog = await open();
    await within(dialog).findByText("Interviewing at Stripe");

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete: Interviewing at Stripe" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/agent/memories/m2", { method: "DELETE" });
    await waitFor(() =>
      expect(within(dialog).queryByText("Interviewing at Stripe")).not.toBeInTheDocument(),
    );
  });

  it("shows an error when saving fails", async () => {
    const dialog = await open();
    await within(dialog).findByText("Avoid crypto companies");
    fetchMock.mockImplementation(() =>
      json({ error: "Memory content must be between 1 and 300 characters." }, 400),
    );

    await userEvent.click(within(dialog).getByRole("button", { name: "Edit: Avoid crypto companies" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Memory content must be between 1 and 300 characters.",
    );
  });
});
