import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { addNoteAction } from "@/app/actions/pipeline/add-note";
import { updateNoteAction } from "@/app/actions/pipeline/update-note";
import { deleteNoteAction } from "@/app/actions/pipeline/delete-note";
import { COMPANY_A, COMPANY_B } from "@/test/utils/recruiter";
import { noteOf, pipelineAppOf } from "@/test/utils/pipeline";
import NotesPanel from "./NotesPanel";

vi.mock("@/app/actions/pipeline/add-note", () => ({ addNoteAction: vi.fn() }));
vi.mock("@/app/actions/pipeline/update-note", () => ({ updateNoteAction: vi.fn() }));
vi.mock("@/app/actions/pipeline/delete-note", () => ({ deleteNoteAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// Radix Select doesn't run in jsdom; a native <select> named by the trigger's
// aria-label keeps the same contract.
vi.mock("@/components/ui/select", () => {
  const SelectTrigger: (props: { "aria-label"?: string; children?: ReactNode }) => null = () => null;
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (v: string) => void;
      children: ReactNode;
    }) => {
      const trigger = Children.toArray(children).find(
        (child) => isValidElement(child) && child.type === SelectTrigger,
      ) as { props: { "aria-label"?: string } } | undefined;
      return (
        <select
          aria-label={trigger?.props["aria-label"]}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        >
          {children}
        </select>
      );
    },
    SelectTrigger,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

const APP = pipelineAppOf();
const ME = COMPANY_A.user.id;
const OTHER = COMPANY_B.user.id;

const composer = () => screen.getByRole("textbox", { name: "New note" });
const addButton = () => screen.getByRole("button", { name: "Add note" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NotesPanel (PLT-054)", () => {
  it("adds a note with a rating and clears the composer", async () => {
    const saved = noteOf({ application_id: APP.id, author_user_id: ME, body: "Great call", rating: "yes" });
    vi.mocked(addNoteAction).mockResolvedValue({ ok: true, note: saved });
    render(<NotesPanel applicationId={APP.id} notes={[]} currentUserId={ME} />);

    fireEvent.change(composer(), { target: { value: "Great call" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Rating" }), { target: { value: "yes" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(composer()).toHaveValue(""));
    expect(addNoteAction).toHaveBeenCalledWith({ applicationId: APP.id, body: "Great call", rating: "yes" });
    expect(screen.getByText("Great call")).toBeInTheDocument();
  });

  it("sends no rating when none is picked", async () => {
    vi.mocked(addNoteAction).mockResolvedValue({ ok: true, note: noteOf({ author_user_id: ME }) });
    render(<NotesPanel candidateUserId={APP.applicant_user_id!} notes={[]} currentUserId={ME} />);

    fireEvent.change(composer(), { target: { value: "Hi" } });
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(addNoteAction).toHaveBeenCalledWith({
        candidateUserId: APP.applicant_user_id,
        body: "Hi",
        rating: null,
      }),
    );
  });

  it("disables Add note over 5,000 chars and when empty", () => {
    render(<NotesPanel applicationId={APP.id} notes={[]} currentUserId={ME} />);

    expect(addButton()).toBeDisabled();
    fireEvent.change(composer(), { target: { value: "x".repeat(5001) } });
    expect(addButton()).toBeDisabled();
    expect(screen.getByText("5,001 / 5,000")).toBeInTheDocument();
  });

  it("keeps the text and toasts when the action refuses", async () => {
    vi.mocked(addNoteAction).mockResolvedValue({ ok: false, error: "Notes can't mention that." });
    render(<NotesPanel applicationId={APP.id} notes={[]} currentUserId={ME} />);

    fireEvent.change(composer(), { target: { value: "Hi" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Notes can't mention that."));
    expect(composer()).toHaveValue("Hi");
  });

  it("renders markdown and shows raw HTML as text", () => {
    const { container } = render(
      <NotesPanel
        applicationId={APP.id}
        notes={[
          noteOf({ body: "**Strong** on systems" }),
          noteOf({ body: '<img src=x onerror="alert(1)">' }),
        ]}
        currentUserId={ME}
      />,
    );

    expect(screen.getByText("Strong").tagName).toBe("STRONG");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x onerror/)).toBeInTheDocument();
  });

  it("shows edit and delete only on the author's own notes", () => {
    render(
      <NotesPanel
        applicationId={APP.id}
        notes={[
          noteOf({ body: "Mine", author_user_id: ME, author_name: "Asha" }),
          noteOf({ body: "Theirs", author_user_id: OTHER, author_name: "Ravi" }),
        ]}
        currentUserId={ME}
      />,
    );

    const mine = screen.getByText("Mine").closest("li") as HTMLElement;
    const theirs = screen.getByText("Theirs").closest("li") as HTMLElement;
    expect(within(mine).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(mine).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(within(theirs).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(within(theirs).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(within(theirs).getByText("Ravi")).toBeInTheDocument();
  });

  it("edits a note in place", async () => {
    const note = noteOf({ body: "Mine", author_user_id: ME });
    vi.mocked(updateNoteAction).mockResolvedValue({ ok: true });
    render(<NotesPanel applicationId={APP.id} notes={[note]} currentUserId={ME} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit note" }), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Edited")).toBeInTheDocument());
    expect(updateNoteAction).toHaveBeenCalledWith({ noteId: note.id, body: "Edited", rating: null });
  });

  it("deletes a note after confirming", async () => {
    const note = noteOf({ body: "Mine", author_user_id: ME });
    vi.mocked(deleteNoteAction).mockResolvedValue({ ok: true });
    render(<NotesPanel applicationId={APP.id} notes={[note]} currentUserId={ME} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    await waitFor(() => expect(screen.queryByText("Mine")).not.toBeInTheDocument());
    expect(deleteNoteAction).toHaveBeenCalledWith({ noteId: note.id });
  });

  it("puts the rating summary on top", () => {
    render(
      <NotesPanel
        applicationId={APP.id}
        notes={[
          noteOf({ rating: "strong_yes" }),
          noteOf({ rating: "no" }),
          noteOf({ rating: null }),
        ]}
        currentUserId={ME}
      />,
    );

    const summary = screen.getByRole("region", { name: "Ratings" });
    expect(summary).toHaveTextContent("3.0 from 2 ratings");
    expect(summary).toHaveTextContent("Strong yes 1");
    expect(summary).toHaveTextContent("No 1");
  });

  it("says when there are no ratings yet", () => {
    render(<NotesPanel applicationId={APP.id} notes={[]} currentUserId={ME} />);

    expect(screen.getByRole("region", { name: "Ratings" })).toHaveTextContent("No ratings yet");
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
  });
});
