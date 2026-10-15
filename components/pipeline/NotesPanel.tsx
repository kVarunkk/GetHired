"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { addNoteAction } from "@/app/actions/pipeline/add-note";
import { updateNoteAction } from "@/app/actions/pipeline/update-note";
import { deleteNoteAction } from "@/app/actions/pipeline/delete-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RATING_LABELS,
  ratingSummary,
  type CandidateRating,
} from "@/helpers/pipeline/ratings";
import type { Tables } from "@/utils/types/database.types";
import { cn } from "@/utils/utils";

type Note = Tables<"candidate_notes">;

const MAX_LENGTH = 5000;
const NO_RATING = "none";
const RATINGS = Object.keys(RATING_LABELS) as CandidateRating[];

// No images, and links open outside the app. react-markdown escapes raw HTML.
const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">
      {children}
    </a>
  ),
  img: () => null,
};

function NoteBody({ body }: { body: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words text-sm dark:prose-invert">
      <ReactMarkdown components={MARKDOWN_COMPONENTS}>{body}</ReactMarkdown>
    </div>
  );
}

function RatingSelect({
  value,
  onChange,
}: {
  value: CandidateRating | null;
  onChange: (rating: CandidateRating | null) => void;
}) {
  return (
    <Select
      value={value ?? NO_RATING}
      onValueChange={(v) => onChange(v === NO_RATING ? null : (v as CandidateRating))}
    >
      <SelectTrigger className="h-8 w-[140px]" aria-label="Rating">
        <SelectValue placeholder="Rating" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_RATING}>No rating</SelectItem>
        {RATINGS.map((rating) => (
          <SelectItem key={rating} value={rating}>
            {RATING_LABELS[rating]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LengthCounter({ length }: { length: number }) {
  return (
    <span className={cn("text-xs text-muted-foreground", length > MAX_LENGTH && "text-destructive")}>
      {length.toLocaleString("en-US")} / {MAX_LENGTH.toLocaleString("en-US")}
    </span>
  );
}

const fits = (text: string) => text.trim().length > 0 && text.length <= MAX_LENGTH;

/**
 * The applicant page's Notes tab (PL-TASK-021, PL-REQ-006): a rating summary,
 * a composer with an optional rating, and the company's notes, newest first.
 * Only the author can edit or delete a note. Notes never reach the candidate.
 */
export default function NotesPanel({
  applicationId,
  candidateUserId,
  notes: initialNotes,
  currentUserId,
}: {
  applicationId?: string;
  candidateUserId?: string;
  notes: Note[];
  currentUserId: string;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [body, setBody] = useState("");
  const [rating, setRating] = useState<CandidateRating | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const summary = ratingSummary(notes);

  const add = async () => {
    setIsSaving(true);
    try {
      const target = applicationId ? { applicationId } : { candidateUserId };
      const result = await addNoteAction({ ...target, body, rating });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setNotes((current) => [result.note, ...current]);
      setBody("");
      setRating(null);
    } catch {
      toast.error("Couldn't save the note. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Ratings" className="rounded-lg border px-4 py-3 text-sm">
        {summary.average === null ? (
          <p className="text-muted-foreground">No ratings yet</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <p>
              <span className="font-semibold">{summary.average.toFixed(1)}</span> from {summary.count}{" "}
              rating{summary.count === 1 ? "" : "s"}
            </p>
            {RATINGS.slice()
              .reverse()
              .map((r) => (
                <span key={r} className="text-muted-foreground">
                  <span>{RATING_LABELS[r]}</span> <span>{summary.byRating[r]}</span>
                </span>
              ))}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <Textarea
          aria-label="New note"
          placeholder="Write a note (markdown). Only your company sees it."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
        />
        <div className="flex flex-wrap items-center gap-2">
          <RatingSelect value={rating} onChange={setRating} />
          <LengthCounter length={body.length} />
          <Button
            size="sm"
            className="ml-auto"
            disabled={!fits(body) || isSaving}
            onClick={() => void add()}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add note
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              isMine={note.author_user_id === currentUserId}
              onSaved={(next) => setNotes((current) => current.map((n) => (n.id === next.id ? next : n)))}
              onDeleted={() => setNotes((current) => current.filter((n) => n.id !== note.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteItem({
  note,
  isMine,
  onSaved,
  onDeleted,
}: {
  note: Note;
  isMine: boolean;
  onSaved: (note: Note) => void;
  onDeleted: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [body, setBody] = useState(note.body);
  const [rating, setRating] = useState<CandidateRating | null>(note.rating);
  const [isBusy, setIsBusy] = useState(false);

  const save = async () => {
    setIsBusy(true);
    try {
      const result = await updateNoteAction({ noteId: note.id, body, rating });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onSaved({ ...note, body: body.trim(), rating });
      setMode("view");
    } catch {
      toast.error("Couldn't save the note. Please try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const remove = async () => {
    setIsBusy(true);
    try {
      const result = await deleteNoteAction({ noteId: note.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onDeleted();
    } catch {
      toast.error("Couldn't delete the note. Please try again.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{note.author_name ?? "A teammate"}</span>
        <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
        {note.rating && (
          <Badge variant="outline" className="font-normal">
            {RATING_LABELS[note.rating]}
          </Badge>
        )}
        {isMine && mode === "view" && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setMode("edit")}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => setMode("confirm-delete")}
            >
              Delete
            </Button>
          </span>
        )}
      </div>

      {mode === "edit" ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label="Edit note" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          <div className="flex flex-wrap items-center gap-2">
            <RatingSelect value={rating} onChange={setRating} />
            <LengthCounter length={body.length} />
            <span className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={isBusy}
                onClick={() => {
                  setBody(note.body);
                  setRating(note.rating);
                  setMode("view");
                }}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={!fits(body) || isBusy} onClick={() => void save()}>
                Save
              </Button>
            </span>
          </div>
        </div>
      ) : (
        <NoteBody body={note.body} />
      )}

      {mode === "confirm-delete" && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
          <p>Delete this note?</p>
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => setMode("view")}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" disabled={isBusy} onClick={() => void remove()}>
              Delete note
            </Button>
          </span>
        </div>
      )}
    </li>
  );
}
