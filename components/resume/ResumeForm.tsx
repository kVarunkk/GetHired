"use client";

import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  RESUME_SECTION_LABELS,
  RESUME_SECTION_TYPES,
  RESUME_TEMPLATES,
  type ResumeSectionType,
  type ResumeTemplate,
} from "@/helpers/resume/config";
import type { ResumeContact, ResumeItem, ResumeSection } from "@/helpers/resume/resume-schema";
import type { ResumeOperation } from "@/helpers/resumes/resume-operations";
import type { EditorDraft } from "./resume-editor-state";
import SortableList from "./SortableList";

type Apply = (...operations: ResumeOperation[]) => void;

/** The messages to show, by field path. */
export type FieldErrors = Map<string, string>;

function FieldError({ errors, path }: { errors: FieldErrors; path: string }) {
  const message = errors.get(path);
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {message}
    </p>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  errors,
  path,
  type = "text",
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  errors: FieldErrors;
  path: string;
  type?: string;
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        className="mt-1"
        value={value ?? ""}
        aria-invalid={errors.has(path) || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError errors={errors} path={path} />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const TEMPLATE_LABELS: Record<ResumeTemplate, string> = { classic: "Classic", compact: "Compact" };

function ResumeDetails({ draft, apply, errors }: { draft: EditorDraft; apply: Apply; errors: FieldErrors }) {
  return (
    <Group title="Resume">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="resume-name"
          label="Resume name"
          value={draft.name}
          onChange={(name) => apply({ op: "rename", name })}
          errors={errors}
          path="name"
        />
        <div>
          <Label htmlFor="resume-template">Template</Label>
          <Select
            value={draft.template}
            onValueChange={(template) => apply({ op: "setTemplate", template: template as ResumeTemplate })}
          >
            <SelectTrigger id="resume-template" aria-label="Template" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESUME_TEMPLATES.map((template) => (
                <SelectItem key={template} value={template}>
                  {TEMPLATE_LABELS[template]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </Group>
  );
}

const CONTACT_FIELDS = [
  ["fullName", "Full name", "text"],
  ["headline", "Headline", "text"],
  ["email", "Email", "email"],
  ["phone", "Phone", "tel"],
  ["location", "Location", "text"],
] as const;

function ContactDetails({ contact, apply, errors }: { contact: ResumeContact; apply: Apply; errors: FieldErrors }) {
  const setLinks = (links: ResumeContact["links"]) => apply({ op: "setContact", fields: { links } });

  return (
    <Group title="Contact">
      <div className="grid gap-4 sm:grid-cols-2">
        {CONTACT_FIELDS.map(([field, label, type]) => (
          <TextField
            key={field}
            id={`contact-${field}`}
            label={label}
            type={type}
            value={contact[field]}
            onChange={(value) => apply({ op: "setContact", fields: { [field]: value } })}
            errors={errors}
            path={`contact.${field}`}
          />
        ))}
      </div>
      {contact.links.map((link, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="grid flex-1 gap-4 sm:grid-cols-2">
            <TextField
              id={`contact-link-label-${index}`}
              label="Link label"
              value={link.label}
              onChange={(label) => setLinks(contact.links.map((l, i) => (i === index ? { ...l, label } : l)))}
              errors={errors}
              path={`contact.links.${index}.label`}
            />
            <TextField
              id={`contact-link-url-${index}`}
              label="Link URL"
              value={link.url}
              onChange={(url) => setLinks(contact.links.map((l, i) => (i === index ? { ...l, url } : l)))}
              errors={errors}
              path={`contact.links.${index}.url`}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-6 shrink-0"
            aria-label={`Remove link ${link.label || index + 1}`}
            onClick={() => setLinks(contact.links.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <FieldError errors={errors} path="contact.links" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setLinks([...contact.links, { label: "", url: "" }])}
      >
        <Plus className="h-4 w-4" />
        Add link
      </Button>
    </Group>
  );
}

const ITEM_FIELDS = [
  ["heading", "Title"],
  ["subheading", "Organization"],
  ["location", "Location"],
  ["startDate", "Start"],
  ["endDate", "End"],
  ["url", "Link"],
] as const;

function ItemEditor({
  section,
  item,
  path,
  apply,
  errors,
  onFocusBullet,
}: {
  section: ResumeSection;
  item: ResumeItem;
  path: string;
  apply: Apply;
  errors: FieldErrors;
  onFocusBullet: (id: string) => void;
}) {
  const isSummary = section.type === "summary";

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      {!isSummary && (
        <div className="grid gap-3 sm:grid-cols-2">
          {ITEM_FIELDS.map(([field, label]) => (
            <TextField
              key={field}
              id={`${item.id}-${field}`}
              label={label}
              value={item[field]}
              onChange={(value) => apply({ op: "setItemFields", itemId: item.id, fields: { [field]: value } })}
              errors={errors}
              path={`${path}.${field}`}
            />
          ))}
        </div>
      )}
      <SortableList
        items={item.bullets}
        label={(bullet, index) => `${isSummary ? "paragraph" : "bullet"} ${index + 1}${bullet.text ? `: ${bullet.text.slice(0, 40)}` : ""}`}
        onMove={(id, index) => apply({ op: "move", id, index })}
      >
        {(bullet, index) => (
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <Textarea
                aria-label={isSummary ? "Summary text" : "Bullet"}
                rows={2}
                value={bullet.text}
                aria-invalid={errors.has(`${path}.bullets.${index}.text`) || undefined}
                onFocus={() => onFocusBullet(bullet.id)}
                onChange={(event) => apply({ op: "setBulletText", bulletId: bullet.id, text: event.target.value })}
              />
              <FieldError errors={errors} path={`${path}.bullets.${index}.text`} />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={`Remove ${isSummary ? "paragraph" : "bullet"} ${index + 1}`}
              onClick={() => apply({ op: "removeBullet", bulletId: bullet.id })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </SortableList>
      <FieldError errors={errors} path={`${path}.bullets`} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => apply({ op: "addBullet", itemId: item.id, text: "" })}
        >
          <Plus className="h-4 w-4" />
          {isSummary ? "Add paragraph" : "Add bullet"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => apply({ op: "removeItem", itemId: item.id })}>
          <Trash2 className="h-4 w-4" />
          Remove entry
        </Button>
      </div>
    </div>
  );
}

const sectionLabel = (section: ResumeSection) => section.title || RESUME_SECTION_LABELS[section.type];

function SectionEditor({
  section,
  path,
  apply,
  errors,
  onFocusBullet,
}: {
  section: ResumeSection;
  path: string;
  apply: Apply;
  errors: FieldErrors;
  onFocusBullet: (id: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            id={`${section.id}-title`}
            label={`${RESUME_SECTION_LABELS[section.type]} section title`}
            value={section.title}
            onChange={(title) => apply({ op: "setSectionTitle", sectionId: section.id, title })}
            errors={errors}
            path={`${path}.title`}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove section ${sectionLabel(section)}`}
          onClick={() => apply({ op: "removeSection", sectionId: section.id })}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <SortableList
        items={section.items}
        label={(item, index) => `entry ${index + 1}${item.heading ? `: ${item.heading}` : ""}`}
        onMove={(id, index) => apply({ op: "move", id, index })}
      >
        {(item, index) => (
          <ItemEditor
            section={section}
            item={item}
            path={`${path}.items.${index}`}
            apply={apply}
            errors={errors}
            onFocusBullet={onFocusBullet}
          />
        )}
      </SortableList>
      <FieldError errors={errors} path={`${path}.items`} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          apply({ op: "addItem", sectionId: section.id, bullets: section.type === "summary" ? [""] : [] })
        }
      >
        <Plus className="h-4 w-4" />
        Add entry
      </Button>
    </section>
  );
}

function AddSection({ apply }: { apply: Apply }) {
  const [resetKey, setResetKey] = useState(0);

  return (
    <div>
      <Label htmlFor="add-section">Add a section</Label>
      <Select
        key={resetKey}
        onValueChange={(type) => {
          apply({ op: "addSection", sectionType: type as ResumeSectionType });
          setResetKey((key) => key + 1);
        }}
      >
        <SelectTrigger id="add-section" aria-label="Add a section" className="mt-1">
          <SelectValue placeholder="Choose a section" />
        </SelectTrigger>
        <SelectContent>
          {RESUME_SECTION_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {RESUME_SECTION_LABELS[type]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The editor's form. All state lives in ResumeEditor: every change is an operation. */
export default function ResumeForm({
  draft,
  apply,
  errors,
  onFocusBullet,
}: {
  draft: EditorDraft;
  apply: Apply;
  errors: FieldErrors;
  onFocusBullet: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ResumeDetails draft={draft} apply={apply} errors={errors} />
      <ContactDetails contact={draft.contact} apply={apply} errors={errors} />
      <SortableList
        items={draft.content.sections}
        label={(section) => `section ${sectionLabel(section)}`}
        onMove={(id, index) => apply({ op: "move", id, index })}
      >
        {(section, index) => (
          <SectionEditor
            section={section}
            path={`sections.${index}`}
            apply={apply}
            errors={errors}
            onFocusBullet={onFocusBullet}
          />
        )}
      </SortableList>
      <FieldError errors={errors} path="sections" />
      <AddSection apply={apply} />
    </div>
  );
}
