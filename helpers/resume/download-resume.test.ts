// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadResume } from "./download-resume";

const fetchMock = vi.fn();
const click = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:resume");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  click.mockReset();
});

describe("downloadResume", () => {
  it("saves the file under the route's name", async () => {
    fetchMock.mockResolvedValue(
      new Response("pdf", { headers: { "content-disposition": 'attachment; filename="Backend.pdf"' } }),
    );
    let savedAs: string | undefined;
    click.mockImplementation(function (this: HTMLAnchorElement) {
      savedAs = this.download;
    });

    expect(await downloadResume("r1", "pdf")).toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith("/api/resumes/r1/export?format=pdf");
    expect(savedAs).toBe("Backend.pdf");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:resume");
  });

  it("passes on the route's message", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Download Word instead." }, { status: 422 }));

    expect(await downloadResume("r1", "pdf")).toEqual({ ok: false, error: "Download Word instead." });
    expect(click).not.toHaveBeenCalled();
  });

  it("survives a failure with no message, and no connection", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    expect(await downloadResume("r1", "docx")).toMatchObject({ ok: false });

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await downloadResume("r1", "docx")).toMatchObject({ ok: false });
  });
});
