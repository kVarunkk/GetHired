import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dismissResumeNotesAction } from "@/app/actions/resumes/dismiss-resume-notes";
import { saveResumeAction } from "@/app/actions/resumes/save-resume";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import type { EditorDraft } from "./resume-editor-state";
import ResumeEditor from "./ResumeEditor";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("@/app/actions/resumes/save-resume", () => ({ saveResumeAction: vi.fn() }));
vi.mock("@/app/actions/resumes/dismiss-resume-notes", () => ({ dismissResumeNotesAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const RESUME_ID = "22222222-2222-4222-8222-222222222222";

const INITIAL: EditorDraft = {
  name: "Backend",
  template: "classic",
  contact: { fullName: "Ada Lovelace", email: "ada@example.com", links: [{ label: "GitHub", url: "https://github.com/ada" }] },
  content: {
    version: 2,
    sections: [
      {
        id: "s1",
        type: "experience",
        items: [
          {
            id: "i1",
            heading: "Engineer",
            bullets: [
              { id: "b1", text: "First" },
              { id: "b2", text: "Second" },
            ],
          },
        ],
      },
      { id: "s2", type: "skills", items: [] },
    ],
  },
};

const open = (props: Partial<Parameters<typeof ResumeEditor>[0]> = {}) =>
  render(<ResumeEditor resumeId={RESUME_ID} initial={INITIAL} revision={3} {...props} />);

const preview = () => within(screen.getByRole("article", { name: "Resume preview" }));
const saveButton = () => screen.getByRole("button", { name: "Save" });
const bullets = () => screen.getAllByLabelText("Bullet") as HTMLTextAreaElement[];
const type = (element: Element, value: string) => fireEvent.change(element, { target: { value } });

const savedInput = () => vi.mocked(saveResumeAction).mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveResumeAction).mockResolvedValue({ ok: true, revision: 4 });
  vi.mocked(dismissResumeNotesAction).mockResolvedValue({ ok: true });
});

describe("ResumeEditor edits (RE-REQ-032)", () => {
  it("shows each edit in the live preview", () => {
    open();

    type(screen.getByLabelText("Full name"), "Grace Hopper");
    type(bullets()[0], "Rewrote it");
    type(screen.getByLabelText("Title"), "Staff Engineer");

    expect(preview().getByText("Grace Hopper")).toBeInTheDocument();
    expect(preview().getByText("Rewrote it")).toBeInTheDocument();
    expect(preview().getByText("Staff Engineer")).toBeInTheDocument();
  });

  it("marks the bullet being edited in the preview", () => {
    open();
    fireEvent.focus(bullets()[1]);
    expect(preview().getByText("Second")).toHaveAttribute("data-active", "true");
  });

  it("adds and removes a bullet", () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: "Add bullet" }));
    expect(bullets()).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Remove bullet 1" }));
    expect(bullets().map((b) => b.value)).toEqual(["Second", ""]);
  });

  it("adds and removes an entry", () => {
    open();

    const skills = screen.getByLabelText("Skills section title").closest("section")!;
    fireEvent.click(within(skills).getByRole("button", { name: "Add entry" }));
    expect(within(skills).getByLabelText("Title")).toBeInTheDocument();

    fireEvent.click(within(skills).getByRole("button", { name: "Remove entry" }));
    expect(within(skills).queryByLabelText("Title")).toBeNull();
  });

  it("adds and removes a section", () => {
    open();

    type(screen.getByLabelText("Add a section"), "awards");
    expect(screen.getByLabelText("Awards section title")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove section Awards" }));
    expect(screen.queryByLabelText("Awards section title")).toBeNull();
  });

  it("edits contact links", () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.getAllByLabelText("Link URL")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove link GitHub" }));
    expect(screen.getAllByLabelText("Link URL")).toHaveLength(1);
  });

  it("changes the name and template", async () => {
    open();

    type(screen.getByLabelText("Resume name"), "Frontend");
    type(screen.getByLabelText("Template"), "compact");
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveResumeAction).toHaveBeenCalled());
    expect(savedInput()).toMatchObject({ name: "Frontend", template: "compact" });
  });

  describe("reordering by keyboard", () => {
    const handle = (name: RegExp) => screen.getByRole("button", { name });

    it("moves a bullet", () => {
      open();

      fireEvent.keyDown(handle(/^Move bullet 1/), { key: "ArrowDown" });

      expect(bullets().map((b) => b.value)).toEqual(["Second", "First"]);
    });

    it("moves a section", () => {
      open();

      fireEvent.keyDown(handle(/^Move section Skills/), { key: "ArrowUp" });

      const labels = screen.getAllByLabelText(/section title$/).map((input) => input.id);
      expect(labels).toEqual(["s2-title", "s1-title"]);
    });

    it("stays put at the edges", () => {
      open();

      fireEvent.keyDown(handle(/^Move bullet 1/), { key: "ArrowUp" });
      fireEvent.keyDown(handle(/^Move bullet 2/), { key: "ArrowDown" });

      expect(bullets().map((b) => b.value)).toEqual(["First", "Second"]);
      expect(saveButton()).toBeDisabled();
    });
  });
});

describe("saving (RE-REQ-033)", () => {
  it("has nothing to save until something changes", () => {
    open();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  });

  it("sends the draft with the revision it read, then the new one", async () => {
    open();

    type(bullets()[0], "Changed");
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).toBeNull());

    expect(savedInput()).toMatchObject({ resumeId: RESUME_ID, expectedRevision: 3 });
    expect(savedInput().content.sections[0].items[0].bullets[0]).toEqual({ id: "b1", text: "Changed" });

    type(bullets()[0], "Changed again");
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveResumeAction).toHaveBeenCalledTimes(2));

    expect(vi.mocked(saveResumeAction).mock.calls[1][0].expectedRevision).toBe(4);
  });

  it("offers a reload on RESUME_CHANGED, and keeps the edits on screen", async () => {
    vi.mocked(saveResumeAction).mockResolvedValue({ ok: false, code: "RESUME_CHANGED", error: "Reload." });
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    open();

    type(bullets()[0], "Changed");
    fireEvent.click(saveButton());

    fireEvent.click(await screen.findByRole("button", { name: "Reload" }));

    expect(reload).toHaveBeenCalled();
    expect(bullets()[0].value).toBe("Changed");
    expect(saveButton()).toBeDisabled();
    vi.unstubAllGlobals();
  });

  it("shows a failed save", async () => {
    vi.mocked(saveResumeAction).mockResolvedValue({ ok: false, code: "UPGRADE_FAILED", error: "Upload it again." });
    open();

    type(bullets()[0], "Changed");
    fireEvent.click(saveButton());

    expect(await screen.findByText("Upload it again.")).toBeInTheDocument();
  });

  it("shows a lost connection", async () => {
    vi.mocked(saveResumeAction).mockRejectedValue(new Error("offline"));
    open();

    type(bullets()[0], "Changed");
    fireEvent.click(saveButton());

    expect(await screen.findByText(/couldn't save your changes/)).toBeInTheDocument();
    expect(saveButton()).not.toBeDisabled();
  });
});

describe("the limits", () => {
  it("shows a passed limit as it happens", () => {
    open();

    type(bullets()[0], "x".repeat(RESUME_LIMITS.bulletChars + 1));

    expect(screen.getByText(`Keep a bullet under ${RESUME_LIMITS.bulletChars} characters.`)).toBeInTheDocument();
    expect(bullets()[0]).toHaveAttribute("aria-invalid", "true");
  });

  it("doesn't call a new empty bullet an error until Save", () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: "Add bullet" }));
    expect(screen.queryByText("A bullet can't be empty.")).toBeNull();

    fireEvent.click(saveButton());
    expect(screen.getByText("A bullet can't be empty.")).toBeInTheDocument();
  });

  it("won't send an invalid resume", () => {
    open();

    type(screen.getByLabelText("Resume name"), " ");
    fireEvent.click(saveButton());

    expect(screen.getByText("Give this resume a name.")).toBeInTheDocument();
    expect(screen.getByText(/Fix the highlighted fields/)).toBeInTheDocument();
    expect(saveResumeAction).not.toHaveBeenCalled();
  });

  it("shows an unsafe link on its field", () => {
    open();

    type(screen.getByLabelText("Link URL"), "javascript:alert(1)");
    fireEvent.click(saveButton());

    expect(screen.getByText("Links must start with http:// or https://.")).toBeInTheDocument();
  });
});

describe("the unsaved-changes guard", () => {
  const leavePage = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  const clickLink = () => {
    const link = document.createElement("a");
    link.href = "/resume";
    link.addEventListener("click", (event) => event.preventDefault());
    document.body.appendChild(link);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const stop = vi.spyOn(event, "stopPropagation");
    link.dispatchEvent(event);
    link.remove();
    return stop;
  };

  it("stays out of the way with nothing to lose", () => {
    const confirm = vi.spyOn(window, "confirm");
    open();

    expect(leavePage().defaultPrevented).toBe(false);
    clickLink();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("warns before the tab closes", () => {
    open();
    type(bullets()[0], "Changed");

    expect(leavePage().defaultPrevented).toBe(true);
  });

  it("asks before a link leaves, and stays if told to", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    open();
    type(bullets()[0], "Changed");

    expect(clickLink()).toHaveBeenCalled();
  });

  it("lets the link through when told to", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    open();
    type(bullets()[0], "Changed");

    expect(clickLink()).not.toHaveBeenCalled();
  });

  it("stops warning after a save", async () => {
    open();
    type(bullets()[0], "Changed");
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).toBeNull());

    // The listener goes in an effect, which can run just after that render.
    await waitFor(() => expect(leavePage().defaultPrevented).toBe(false));
  });
});

describe("Discard", () => {
  it("asks, then goes back to the last save", async () => {
    open();
    type(bullets()[0], "Changed");

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(bullets()[0].value).toBe("First"));
    expect(saveButton()).toBeDisabled();
  });

  it("can be called off", async () => {
    open();
    type(bullets()[0], "Changed");

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));

    expect(bullets()[0].value).toBe("Changed");
  });
});

describe("the parse notes notice (RE-REQ-016)", () => {
  it("doesn't show without unused lines", () => {
    open();
    expect(screen.queryByText(/weren't added/)).toBeNull();
  });

  it("lists the lines and dismisses", async () => {
    open({ unusedLines: ["Referees on request", "Page 2"] });

    expect(screen.getByText(/weren't added/)).toBeInTheDocument();
    expect(screen.getByText("Referees on request")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(screen.queryByText(/weren't added/)).toBeNull());
    expect(dismissResumeNotesAction).toHaveBeenCalledWith({ resumeId: RESUME_ID });
  });

  it("stays when the dismiss fails", async () => {
    vi.mocked(dismissResumeNotesAction).mockResolvedValue({ ok: false, error: "No." });
    open({ unusedLines: ["Page 2"] });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(dismissResumeNotesAction).toHaveBeenCalled());
    expect(screen.getByText(/weren't added/)).toBeInTheDocument();
  });
});
