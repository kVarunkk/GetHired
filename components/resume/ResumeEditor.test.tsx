import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissResumeNotesAction } from "@/app/actions/resumes/dismiss-resume-notes";
import { saveResumeAction } from "@/app/actions/resumes/save-resume";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import { editorReducer, type EditorDraft } from "./resume-editor-state";
import ResumeEditor from "./ResumeEditor";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
const locationRenders = vi.hoisted(() => new Map<string, number>());
vi.mock("@/components/LocationSearchSelect", () => ({
  default: ({ id, onChange }: { id: string; onChange: (name: string, locations: string[]) => void }) => {
    locationRenders.set(id, (locationRenders.get(id) ?? 0) + 1);
    return (
      <button type="button" id={id} onClick={() => onChange("location", ["Pune"])}>
        Pick Pune
      </button>
    );
  },
}));
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

  it("starts a known section's title at its label, and lets the user change it", () => {
    open();

    const title = screen.getByLabelText("Experience section title");
    expect(title).toHaveValue("Experience");

    type(title, "");
    expect(title).toHaveValue("");

    type(title, "Work history");
    expect(title).toHaveValue("Work history");
    expect(preview().getByText("Work history")).toBeInTheDocument();
  });

  it("leaves an Other section's title for the user", () => {
    open();

    fireEvent.change(screen.getByLabelText("Add a section"), { target: { value: "other" } });

    expect(screen.getByLabelText("Other section title")).toHaveValue("");
  });

  it("sets an entry's location and dates through their pickers", () => {
    open();

    fireEvent.click(screen.getByLabelText("Location", { selector: "#i1-location" }));
    fireEvent.click(screen.getByLabelText("End"));
    fireEvent.click(screen.getByRole("button", { name: "Present" }));

    expect(preview().getByText(/Pune/)).toHaveTextContent("Present");

    fireEvent.click(screen.getAllByRole("button", { name: "Clear location" })[0]);
    expect(preview().queryByText(/Pune/)).toBeNull();
  });

  it("refuses to save an entry that ends before it starts", async () => {
    open({
      initial: {
        ...INITIAL,
        content: {
          version: 2,
          sections: [
            { id: "s1", type: "experience", items: [{ id: "i1", startDate: "Mar 2021", endDate: "Jan 2020", bullets: [] }] },
          ],
        },
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("The end date can't be before the start date.");

    type(screen.getByLabelText("Full name"), "Grace Hopper");
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText("The end date can't be before the start date.")).toBeInTheDocument());
    expect(saveResumeAction).not.toHaveBeenCalled();
  });

  it("sets the contact location through the picker", () => {
    open();

    fireEvent.click(screen.getByLabelText("Location", { selector: "#contact-location" }));

    expect(preview().getByText(/Pune/)).toBeInTheDocument();
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

describe("typing stays cheap", () => {
  const typeBullet = (draft: EditorDraft, text: string) =>
    editorReducer(draft, { type: "apply", operations: [{ op: "setBulletText", bulletId: "b1", text }] });

  it("keeps everything an edit didn't touch", () => {
    const next = typeBullet(INITIAL, "Changed");

    expect(next.content.sections[0].items[0].bullets[0].text).toBe("Changed");
    expect(next.content.sections[0].items[0].bullets[1]).toBe(INITIAL.content.sections[0].items[0].bullets[1]);
    expect(next.content.sections[1]).toBe(INITIAL.content.sections[1]);
    expect(next.contact).toBe(INITIAL.contact);
  });

  it("returns the same draft for an edit that changes nothing", () => {
    expect(typeBullet(INITIAL, "First")).toBe(INITIAL);
  });

  it("keeps a removed bullet removed", () => {
    const next = editorReducer(INITIAL, { type: "apply", operations: [{ op: "removeBullet", bulletId: "b1" }] });

    expect(next.content.sections[0].items[0].bullets.map((bullet) => bullet.id)).toEqual(["b2"]);
  });

  it("re-renders only the part being edited", () => {
    open();
    locationRenders.clear();

    type(bullets()[0], "Changed");
    expect(locationRenders.has("contact-location")).toBe(false);

    locationRenders.clear();
    type(screen.getByLabelText("Full name"), "Grace Hopper");
    expect(locationRenders.has("i1-location")).toBe(false);
  });

  it("checks the latest draft on Save", () => {
    open();

    type(screen.getByLabelText("Resume name"), "");
    fireEvent.click(saveButton());

    expect(saveResumeAction).not.toHaveBeenCalled();
    expect(screen.getByText("Give this resume a name.")).toBeInTheDocument();
  });
});

describe("keeping the form and the preview together", () => {
  const box = (element: Element, top: number, bottom: number) =>
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ top, bottom } as DOMRect);

  const previewPane = () => screen.getByRole("article", { name: "Resume preview" }).parentElement as HTMLElement;

  const stubPane = () => {
    const pane = previewPane();
    pane.scrollTo = vi.fn();
    box(pane, 100, 500);
    return pane;
  };

  /** The form's part, not the preview's: the form comes first in the page. */
  const formField = (id: string) => document.querySelector(`[data-resume-target="${id}"]`) as HTMLElement;

  const hover = (element: Element, clientX = 10, clientY = 10) => fireEvent.mouseMove(element, { clientX, clientY });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("gives the preview its own scroll area", () => {
    open();

    expect(previewPane().className).toContain("lg:overflow-y-auto");
    expect(previewPane().className).toContain("lg:max-h-");
  });

  describe("focusing a field", () => {
    it("scrolls the preview to a bullet, and only the preview", () => {
      open();
      const pane = stubPane();
      const scrollIntoView = vi.fn();
      const bullet = preview().getByText("Second");
      bullet.scrollIntoView = scrollIntoView;
      box(bullet, 900, 920);

      fireEvent.focus(bullets()[1]);

      expect(pane.scrollTo).toHaveBeenCalledWith({ top: 784, behavior: "smooth" });
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("scrolls to the entry for one of its fields", () => {
      open();
      const pane = stubPane();
      box(preview().getByText("Engineer").parentElement as Element, 700, 800);

      fireEvent.focus(screen.getByLabelText("Title"));

      expect(pane.scrollTo).toHaveBeenCalledWith({ top: 584, behavior: "smooth" });
    });

    it("scrolls to the heading for a section's title", () => {
      open();
      const pane = stubPane();
      box(preview().getByRole("heading", { name: "Experience" }), 600, 620);

      fireEvent.focus(screen.getByLabelText("Experience section title"));

      expect(pane.scrollTo).toHaveBeenCalledWith({ top: 484, behavior: "smooth" });
    });

    it("scrolls to the header for a contact field", () => {
      open();
      const pane = stubPane();
      box(preview().getByText("Ada Lovelace").parentElement as Element, -300, -200);

      fireEvent.focus(screen.getByLabelText("Full name"));

      expect(pane.scrollTo).toHaveBeenCalledWith({ top: -416, behavior: "smooth" });
    });

    it("falls back to the entry for a bullet the preview leaves out", () => {
      open();
      const pane = stubPane();
      box(preview().getByText("Engineer").parentElement as Element, 700, 800);
      fireEvent.click(screen.getAllByRole("button", { name: "Add bullet" })[0]);

      fireEvent.focus(bullets()[2]);

      expect(pane.scrollTo).toHaveBeenCalledWith({ top: 584, behavior: "smooth" });
    });

    it("leaves the preview alone when the part is already showing", () => {
      open();
      const pane = stubPane();
      box(preview().getByText("Second"), 200, 220);

      fireEvent.focus(bullets()[1]);

      expect(pane.scrollTo).not.toHaveBeenCalled();
    });
  });

  describe("hovering the preview", () => {
    const fieldFor = (id: string) => {
      const field = formField(id);
      field.scrollIntoView = vi.fn();
      box(field, 2000, 2100);
      return field;
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("scrolls the form to the part under the mouse after a moment", () => {
      open();
      const field = fieldFor("b2");

      hover(preview().getByText("Second"));
      expect(field.scrollIntoView).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(field.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });

    it("ignores parts the mouse only passes over", () => {
      open();
      const first = fieldFor("b1");
      const second = fieldFor("b2");

      hover(preview().getByText("First"), 10, 10);
      vi.advanceTimersByTime(100);
      hover(preview().getByText("Second"), 10, 30);
      vi.advanceTimersByTime(200);

      expect(first.scrollIntoView).not.toHaveBeenCalled();
      expect(second.scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("does nothing once the mouse has left", () => {
      open();
      const field = fieldFor("b2");

      hover(preview().getByText("Second"));
      fireEvent.mouseLeave(previewPane());
      vi.advanceTimersByTime(200);

      expect(field.scrollIntoView).not.toHaveBeenCalled();
    });

    it("ignores a move with no mouse movement, as when the preview scrolls under it", () => {
      open();
      const first = fieldFor("b1");
      const second = fieldFor("b2");

      hover(preview().getByText("First"), 10, 10);
      vi.advanceTimersByTime(200);
      hover(preview().getByText("Second"), 10, 10);
      vi.advanceTimersByTime(200);

      expect(first.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(second.scrollIntoView).not.toHaveBeenCalled();
    });

    it("marks what's under the mouse while it's on", () => {
      open();

      expect(previewPane().className).toContain("hover:not(:has(");
    });

    it("can be switched off, which also drops the mark", () => {
      open();
      const field = fieldFor("b2");

      fireEvent.click(screen.getByRole("switch", { name: "Scroll form on hover" }));
      hover(preview().getByText("Second"));
      vi.advanceTimersByTime(200);

      expect(field.scrollIntoView).not.toHaveBeenCalled();
      expect(previewPane().className).not.toContain("hover:not(:has(");
    });

    it("still follows focus when it's off", () => {
      open();
      const pane = stubPane();
      box(preview().getByText("Second"), 900, 920);

      fireEvent.click(screen.getByRole("switch", { name: "Scroll form on hover" }));
      fireEvent.focus(bullets()[1]);

      expect(pane.scrollTo).toHaveBeenCalled();
    });

    it("remembers being switched off", () => {
      const first = open();
      fireEvent.click(screen.getByRole("switch", { name: "Scroll form on hover" }));
      first.unmount();

      open();

      expect(screen.getByRole("switch", { name: "Scroll form on hover" })).not.toBeChecked();
    });

    it("works without storage", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      open();

      const toggle = screen.getByRole("switch", { name: "Scroll form on hover" });
      expect(toggle).toBeChecked();
      fireEvent.click(toggle);
      expect(toggle).not.toBeChecked();
      vi.restoreAllMocks();
    });

    it("leaves the form alone when the part is already showing", () => {
      open();
      const field = formField("b2");
      field.scrollIntoView = vi.fn();
      box(field, 100, 200);

      hover(preview().getByText("Second"));
      vi.advanceTimersByTime(200);

      expect(field.scrollIntoView).not.toHaveBeenCalled();
    });
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
