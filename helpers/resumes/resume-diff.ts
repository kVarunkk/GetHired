import { diffWordsWithSpace } from "diff";
import type {
  ResumeDocument,
  ResumeDocumentItem,
  ResumeDocumentSection,
} from "@/helpers/resume/render/document";

// RI-REQ-001: two resumes as one document, each part marked, so an edit can be
// read where it lands. Parts are matched by id. Pure and client-safe.

export type DiffMark = "unchanged" | "changed" | "added" | "removed" | "moved";

export type DiffSegment = { text: string; kind: "same" | "added" | "removed" };

/** One piece of text. `segments` is there only when the wording changed. */
export type DiffText = {
  text: string;
  mark: Exclude<DiffMark, "moved">;
  segments?: DiffSegment[];
};

/** A moved bullet whose wording also changed is `moved` and still has `segments`. */
export type DiffBullet = { id: string; text: string; mark: DiffMark; segments?: DiffSegment[] };

export type DiffItem = {
  id: string;
  mark: DiffMark;
  title?: DiffText;
  meta?: DiffText;
  link?: DiffText;
  bullets: DiffBullet[];
};

export type DiffSection = { id: string; mark: DiffMark; title: DiffText; plain: boolean; items: DiffItem[] };

export type ResumeDiff = {
  template: ResumeDocument["template"];
  name?: DiffText;
  headline?: DiffText;
  contact?: DiffText;
  sections: DiffSection[];
  hasChanges: boolean;
};

const CONTACT_SEPARATOR = " · ";

function wordSegments(before: string, after: string): DiffSegment[] {
  return diffWordsWithSpace(before, after).map(({ value, added, removed }) => ({
    text: value,
    kind: added ? "added" : removed ? "removed" : "same",
  }));
}

function diffText(before: string | undefined, after: string | undefined): DiffText | undefined {
  if (before === undefined && after === undefined) return undefined;
  if (after === undefined) return { text: before!, mark: "removed" };
  if (before === undefined) return { text: after, mark: "added" };
  if (before === after) return { text: after, mark: "unchanged" };
  return { text: after, mark: "changed", segments: wordSegments(before, after) };
}

/**
 * The ids that changed place. The longest run still in the old order stays put,
 * so swapping two parts marks one of them, not everything between.
 */
function movedIds(before: { id: string }[], after: { id: string }[]) {
  const oldIndex = new Map(before.map(({ id }, index) => [id, index]));
  const kept = after.flatMap(({ id }) => (oldIndex.has(id) ? [{ id, index: oldIndex.get(id)! }] : []));

  const runLength = kept.map(() => 1);
  const previous = kept.map(() => -1);
  let best = -1;
  kept.forEach((part, at) => {
    for (let earlier = 0; earlier < at; earlier++) {
      if (kept[earlier].index < part.index && runLength[earlier] + 1 > runLength[at]) {
        runLength[at] = runLength[earlier] + 1;
        previous[at] = earlier;
      }
    }
    if (best === -1 || runLength[at] > runLength[best]) best = at;
  });

  const inPlace = new Set<string>();
  for (let at = best; at !== -1; at = previous[at]) inPlace.add(kept[at].id);
  return new Set(kept.filter(({ id }) => !inPlace.has(id)).map(({ id }) => id));
}

/** The new order, with each removed part back after the part it used to follow. */
function pairInReadingOrder<T extends { id: string }>(before: T[], after: T[]) {
  const previous = new Map(before.map((part) => [part.id, part]));
  const current = new Set(after.map(({ id }) => id));
  const moved = movedIds(before, after);

  const pairs: { id: string; before?: T; after?: T; moved: boolean }[] = after.map((part) => ({
    id: part.id,
    before: previous.get(part.id),
    after: part,
    moved: moved.has(part.id),
  }));

  let anchor: string | null = null;
  for (const part of before) {
    if (!current.has(part.id)) {
      const at = anchor === null ? 0 : pairs.findIndex(({ id }) => id === anchor) + 1;
      pairs.splice(at, 0, { id: part.id, before: part, moved: false });
    }
    anchor = part.id;
  }
  return pairs;
}

function partMark(before: unknown, after: unknown, moved: boolean, parts: ({ mark: DiffMark } | undefined)[]): DiffMark {
  if (!after) return "removed";
  if (!before) return "added";
  if (moved) return "moved";
  return parts.some((part) => part && part.mark !== "unchanged") ? "changed" : "unchanged";
}

function diffBullets(before: ResumeDocumentItem["bullets"], after: ResumeDocumentItem["bullets"]): DiffBullet[] {
  return pairInReadingOrder(before, after).map((pair) => {
    const text = diffText(pair.before?.text, pair.after?.text)!;
    return { ...text, id: pair.id, mark: pair.moved ? "moved" : text.mark };
  });
}

function diffItem(
  id: string,
  before: ResumeDocumentItem | undefined,
  after: ResumeDocumentItem | undefined,
  moved: boolean,
): DiffItem {
  const title = diffText(before?.title, after?.title);
  const meta = diffText(before?.meta, after?.meta);
  const link = diffText(before?.link?.text, after?.link?.text);
  const bullets = diffBullets(before?.bullets ?? [], after?.bullets ?? []);
  return { id, mark: partMark(before, after, moved, [title, meta, link, ...bullets]), title, meta, link, bullets };
}

function diffSection(
  id: string,
  before: ResumeDocumentSection | undefined,
  after: ResumeDocumentSection | undefined,
  moved: boolean,
): DiffSection {
  const title = diffText(before?.title, after?.title)!;
  const items = pairInReadingOrder(before?.items ?? [], after?.items ?? []).map((pair) =>
    diffItem(pair.id, pair.before, pair.after, pair.moved),
  );
  return { id, mark: partMark(before, after, moved, [title, ...items]), title, plain: (after ?? before)!.plain, items };
}

const contactLine = (document: ResumeDocument) =>
  document.contact.map((part) => part.text).join(CONTACT_SEPARATOR) || undefined;

export function diffResume(before: ResumeDocument, after: ResumeDocument): ResumeDiff {
  const name = diffText(before.name, after.name);
  const headline = diffText(before.headline, after.headline);
  const contact = diffText(contactLine(before), contactLine(after));
  const sections = pairInReadingOrder(before.sections, after.sections).map((pair) =>
    diffSection(pair.id, pair.before, pair.after, pair.moved),
  );

  return {
    template: after.template,
    name,
    headline,
    contact,
    sections,
    hasChanges: [name, headline, contact, ...sections].some((part) => part && part.mark !== "unchanged"),
  };
}

export type CompactDiffRow =
  | { type: "unchanged"; count: number }
  | { type: "section"; section: DiffSection }
  | { type: "item"; item: DiffItem; plain: boolean };

/**
 * RI-REQ-004: the changed parts under their section, with each run of unchanged
 * entries as one row. A run can cross sections that didn't change.
 */
export function compactDiffRows(diff: ResumeDiff): CompactDiffRow[] {
  const rows: CompactDiffRow[] = [];
  let unchanged = 0;
  const flush = () => {
    if (unchanged > 0) rows.push({ type: "unchanged", count: unchanged });
    unchanged = 0;
  };

  for (const section of diff.sections) {
    if (section.mark === "unchanged") {
      unchanged += section.items.length;
      continue;
    }
    flush();
    rows.push({ type: "section", section });
    for (const item of section.items) {
      if (item.mark === "unchanged") {
        unchanged += 1;
        continue;
      }
      flush();
      rows.push({ type: "item", item, plain: section.plain });
    }
  }
  flush();
  return rows;
}
