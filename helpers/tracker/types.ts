// Client-safe. The one shape the board, the list, the dashboard, the agent,
// MCP and the extension read (AT-REQ-021).

import type { ApplicationStatus, BoardColumn, TrackedStatus } from "./status";
import type { TrackerSource } from "./context";

export type TrackerItem = {
  kind: "tracked" | "gethired";
  /** The tracked row's id, or the GetHired `applications.id`. */
  id: string;
  allJobsId: string | null;
  jobTitle: string;
  companyName: string;
  location: string | null;
  /** Only tracked cards keep a link; a GetHired card links to its board job. */
  jobUrl: string | null;
  /** Tracked cards: their status. GetHired cards: null. */
  status: TrackedStatus | null;
  /** GetHired cards: the candidate-facing status. Tracked cards: null. */
  gethiredStatus: ApplicationStatus | null;
  statusLabel: string;
  column: BoardColumn;
  /** A GetHired application on hold (`stand_by`). */
  onHold: boolean;
  /** ISO date (yyyy-mm-dd). */
  appliedAt: string;
  statusChangedAt: string;
  updatedAt: string;
  nextFollowUpAt: string | null;
  notes: string | null;
  source: TrackerSource | "gethired";
  position: number;
  /** An old external `applications` row, until migration B moves it (spec §7). */
  legacy: boolean;
  /** The open AI screening interview of a GetHired application. */
  screeningInterviewId: string | null;
};

export type SavedJobItem =
  | {
      kind: "favorite";
      /** The `all_jobs` id. */
      id: string;
      allJobsId: string;
      jobTitle: string;
      companyName: string;
      location: string | null;
      savedAt: string;
    }
  | {
      kind: "tracked";
      id: string;
      allJobsId: null;
      jobTitle: string;
      companyName: string;
      location: string | null;
      jobUrl: string | null;
      notes: string | null;
      savedAt: string;
    };
