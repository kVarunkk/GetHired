import { RESUME_SECTION_LABELS } from "@/helpers/resume/config";
import type { ResumeSection } from "@/helpers/resume/resume-schema";
import type { ResumeDraft } from "./resume-operations";

// RE-REQ-072/082: a resume edit as a before and after, for what the user
// approves. Pure and client-safe.

export type ResumeChange = { label: string; before: string; after: string };

const ITEM_FIELDS = [
  ["heading", "Heading"],
  ["subheading", "Subheading"],
  ["location", "Location"],
  ["startDate", "Start date"],
  ["endDate", "End date"],
  ["url", "Link"],
] as const;

const CONTACT_FIELDS = [
  ["fullName", "Full name"],
  ["headline", "Headline"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["location", "Location"],
] as const;

const NAME_LABEL = "Resume name";
const TEMPLATE_LABEL = "Template";

/** A change the printed resume doesn't show, so a diff of it can't either. */
export const isUnprintedChange = ({ label }: ResumeChange) => label === NAME_LABEL || label === TEMPLATE_LABEL;

const sectionLabel = (section: ResumeSection) => section.title || RESUME_SECTION_LABELS[section.type];

/** Every editable value, by a key that survives a move, with what to call it. */
function fields(draft: ResumeDraft) {
  const entries = new Map<string, { label: string; text: string }>();
  const add = (key: string, label: string, text: string | undefined) => {
    if (text) entries.set(key, { label, text });
  };

  add("name", NAME_LABEL, draft.name);
  add("template", TEMPLATE_LABEL, draft.template);
  for (const [field, label] of CONTACT_FIELDS) add(`contact.${field}`, label, draft.contact[field]);
  add("contact.links", "Links", draft.contact.links.map((link) => `${link.label}: ${link.url}`).join(", "));

  for (const section of draft.content.sections) {
    const label = sectionLabel(section);
    add(`section.${section.id}`, "Section", label);
    for (const item of section.items) {
      const place = item.heading ? `${label}, ${item.heading}` : label;
      for (const [field, fieldLabel] of ITEM_FIELDS) add(`item.${item.id}.${field}`, `${place}: ${fieldLabel}`, item[field]);
      for (const bullet of item.bullets) add(`bullet.${bullet.id}`, place, bullet.text);
    }
  }
  return entries;
}

const order = (draft: ResumeDraft) =>
  JSON.stringify(
    draft.content.sections.map((section) => [
      section.id,
      section.items.map((item) => [item.id, item.bullets.map((bullet) => bullet.id)]),
    ]),
  );

/** What's different, field by field. A move on its own is one change. */
export function describeResumeChanges(before: ResumeDraft, after: ResumeDraft): ResumeChange[] {
  const previous = fields(before);
  const next = fields(after);

  const changes = [...new Set([...previous.keys(), ...next.keys()])].flatMap((key): ResumeChange[] => {
    const was = previous.get(key);
    const now = next.get(key);
    if (was?.text === now?.text) return [];
    return [{ label: (now ?? was)!.label, before: was?.text ?? "", after: now?.text ?? "" }];
  });

  if (changes.length === 0 && order(before) !== order(after)) {
    return [{ label: "Order", before: "", after: "Parts of the resume move" }];
  }
  return changes;
}
