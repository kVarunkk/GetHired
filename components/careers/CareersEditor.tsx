"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, ExternalLink, Loader2, Plus, Trash, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { claimCareersSlugAction } from "@/app/actions/careers/claim-careers-slug";
import { saveCareersPageAction } from "@/app/actions/careers/save-careers-page";
import { setCareersPublishedAction } from "@/app/actions/careers/set-careers-published";
import { uploadCareersImageAction } from "@/app/actions/careers/upload-careers-image";
import type { CareersPage } from "@/helpers/careers/get-careers-page";
import {
  LINK_KEYS,
  LINK_LABELS,
  MAX_CUSTOM_SECTIONS,
  MAX_PERKS,
  accentError,
  type CareersLinks,
  type CareersSection,
} from "@/helpers/careers/page-schema";
import type { CareersSearchView } from "@/helpers/careers/search-company-jobs";
import { parseCareersFilters } from "@/helpers/careers/search-company-jobs";
import { careersPath, validateSlug } from "@/helpers/careers/slug";
import { copyToClipboard } from "@/utils/utils";
import CareersHeader from "./CareersHeader";
import CareersJobs from "./CareersJobs";
import CareersSections from "./CareersSections";
import CareersShell, { DEFAULT_ACCENT } from "./CareersShell";

// CP-REQ-012: the careers page editor. Edits are drafts until Save; the
// preview renders the real page components with the draft values.

const SITE = "https://gethired.devhub.co.in";
const SECTION_LABEL: Record<CareersSection["kind"], string> = { about: "About", perks: "Perks", custom: "Custom section" };
const newId = () => crypto.randomUUID();

function SectionEditor({
  section,
  onChange,
  disabled,
}: {
  section: CareersSection;
  onChange: (next: CareersSection) => void;
  disabled?: boolean;
}) {
  const id = (name: string) => `section-${section.id}-${name}`;
  if (section.kind === "about") {
    return <p className="text-sm text-muted-foreground">Shows your company description from the company profile.</p>;
  }
  if (section.kind === "custom") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("title")}>Title</Label>
          <Input id={id("title")} value={section.title} maxLength={80} disabled={disabled} onChange={(e) => onChange({ ...section, title: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("body")}>Text (markdown)</Label>
          <Textarea
            id={id("body")}
            className="min-h-32 resize-y"
            value={section.body}
            maxLength={10000}
            disabled={disabled}
            onChange={(e) => onChange({ ...section, body: e.target.value })}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("title")}>Title</Label>
        <Input id={id("title")} value={section.title} maxLength={60} disabled={disabled} onChange={(e) => onChange({ ...section, title: e.target.value })} />
      </div>
      <ul className="flex flex-col gap-2">
        {section.items.map((item, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start">
            <Input
              aria-label={`Perk ${i + 1} title`}
              placeholder="Remote first"
              value={item.title}
              maxLength={60}
              disabled={disabled}
              onChange={(e) => onChange({ ...section, items: section.items.map((it, j) => (j === i ? { ...it, title: e.target.value } : it)) })}
            />
            <Input
              aria-label={`Perk ${i + 1} text`}
              placeholder="Work from anywhere in India."
              value={item.text}
              maxLength={300}
              disabled={disabled}
              onChange={(e) => onChange({ ...section, items: section.items.map((it, j) => (j === i ? { ...it, text: e.target.value } : it)) })}
            />
            <Button
              type="button"
              size="icon"
              variant="destructive-ghost"
              aria-label={`Remove perk ${i + 1}`}
              disabled={disabled}
              onClick={() => onChange({ ...section, items: section.items.filter((_, j) => j !== i) })}
            >
              <Trash className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={disabled || section.items.length >= MAX_PERKS}
        onClick={() => onChange({ ...section, items: [...section.items, { title: "", text: "" }] })}
      >
        <Plus className="h-4 w-4" />
        Add perk
      </Button>
    </div>
  );
}

export default function CareersEditor({
  initial,
  jobs,
  canEdit,
  forbidden,
}: {
  initial: CareersPage;
  jobs: CareersSearchView;
  canEdit: boolean;
  /** The reason shown when the role can't edit. */
  forbidden: string;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(initial.slug);
  const [savedSlug, setSavedSlug] = useState(initial.slug);
  const [published, setPublished] = useState(initial.published);
  const [accent, setAccent] = useState(initial.accentColor ?? DEFAULT_ACCENT);
  const [coverUrl, setCoverUrl] = useState(initial.coverUrl);
  const [sections, setSections] = useState<CareersSection[]>(initial.sections);
  const [links, setLinks] = useState<CareersLinks>(initial.links);
  const [busy, setBusy] = useState<string | null>(null);

  const disabled = !canEdit || busy !== null;
  const slugCheck = validateSlug(slug);
  const accentProblem = accentError(accent.toLowerCase());
  const url = `${SITE}${careersPath(savedSlug)}`;
  const draft: CareersPage = { ...initial, slug: savedSlug, accentColor: accentProblem ? initial.accentColor : accent.toLowerCase(), coverUrl, sections, links };

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(key);
    try {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return false;
      }
      toast.success(done);
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    setSections(next);
  };
  const has = (kind: CareersSection["kind"]) => sections.filter((s) => s.kind === kind).length;

  return (
    <div className="flex flex-col gap-8">
      {!canEdit && <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{forbidden}</p>}

      <fieldset disabled={!canEdit} className="flex flex-col gap-8">
        <section className="flex flex-col gap-4 rounded-lg border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Address and publishing</h2>
              <p className="text-sm text-muted-foreground">Share this link from your website and job posts.</p>
            </div>
            <Badge variant={published ? "success" : "secondary"}>{published ? "Published" : "Not published"}</Badge>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="careers-slug">Address</Label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">gethired.devhub.co.in/careers/</span>
              <Input id="careers-slug" className="w-48" value={slug} maxLength={40} onChange={(e) => setSlug(e.target.value)} />
              <Button
                type="button"
                variant="outline"
                disabled={disabled || !slugCheck.ok || slugCheck.slug === savedSlug}
                onClick={async () => {
                  setBusy("slug");
                  const result = await claimCareersSlugAction({ slug }).finally(() => setBusy(null));
                  if (result.ok) {
                    setSavedSlug(result.slug);
                    setSlug(result.slug);
                    toast.success("Address saved. The old one redirects here.");
                    router.refresh();
                  } else toast.error(result.error);
                }}
              >
                Save address
              </Button>
            </div>
            {!slugCheck.ok && slug !== savedSlug && <p className="text-xs text-destructive">{slugCheck.error}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="careers-published"
                checked={published}
                disabled={disabled}
                onCheckedChange={async (checked) => {
                  const ok = await run(
                    "publish",
                    () => setCareersPublishedAction({ published: checked }),
                    checked ? "Your careers page is live." : "Your careers page is hidden.",
                  );
                  if (ok) setPublished(checked);
                }}
              />
              <Label htmlFor="careers-published">Published</Label>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => copyToClipboard(url, "Link copied.")}>
              <Copy className="h-3.5 w-3.5" />
              Copy link
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={published ? careersPath(savedSlug) : "/company/careers/preview"} target="_blank">
                {published ? "View page" : "Preview"}
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-lg border p-5">
          <h2 className="text-lg font-semibold tracking-tight">Branding</h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="careers-accent">Accent colour</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick an accent colour"
                className="h-9 w-12 cursor-pointer rounded-md border bg-transparent"
                value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : DEFAULT_ACCENT}
                onChange={(e) => setAccent(e.target.value)}
              />
              <Input id="careers-accent" className="w-32 font-mono" value={accent} maxLength={7} onChange={(e) => setAccent(e.target.value.trim())} />
            </div>
            <p className={accentProblem ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {accentProblem ?? "Used for buttons and links on your careers page only."}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="careers-cover">Cover image</Label>
            {coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- the company's own upload
              <img src={coverUrl} alt="" className="aspect-[4/1] w-full rounded-lg border object-cover" />
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" asChild disabled={disabled}>
                <label htmlFor="careers-cover" className="cursor-pointer">
                  {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload image
                </label>
              </Button>
              <input
                id="careers-cover"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={disabled}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setBusy("upload");
                  try {
                    const fd = new FormData();
                    fd.append("file", file);
                    const result = await uploadCareersImageAction(fd);
                    if (result.ok) setCoverUrl(result.url);
                    else toast.error(result.error);
                  } finally {
                    setBusy(null);
                  }
                }}
              />
              {coverUrl && (
                <Button type="button" variant="destructive-ghost" disabled={disabled} onClick={() => setCoverUrl(null)}>
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 2 MB. Wide images work best.</p>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-lg border p-5">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Sections</h2>
            <p className="text-sm text-muted-foreground">Shown above your open roles, in this order.</p>
          </div>
          {sections.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No sections yet.</p>}
          <ul className="flex flex-col gap-3">
            {sections.map((section, i) => (
              <li key={section.id} role="group" aria-label={`${SECTION_LABEL[section.kind]} section`} className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {SECTION_LABEL[section.kind]}
                    {section.hidden && <span className="ml-2 text-xs font-normal text-muted-foreground">Hidden</span>}
                  </span>
                  <div className="flex gap-1">
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Move down" disabled={i === sections.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label={section.hidden ? "Show" : "Hide"}
                      onClick={() => setSections(sections.map((s) => (s.id === section.id ? { ...s, hidden: !s.hidden } : s)))}
                    >
                      {section.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </Button>
                    <Button type="button" size="icon" variant="destructive-ghost" className="h-7 w-7" aria-label="Remove section" onClick={() => setSections(sections.filter((s) => s.id !== section.id))}>
                      <Trash className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <SectionEditor section={section} onChange={(next) => setSections(sections.map((s) => (s.id === section.id ? next : s)))} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={has("about") > 0} onClick={() => setSections([...sections, { id: newId(), kind: "about", hidden: false }])}>
              <Plus className="h-4 w-4" />
              About
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={has("perks") > 0}
              onClick={() => setSections([...sections, { id: newId(), kind: "perks", title: "Why join us", hidden: false, items: [] }])}
            >
              <Plus className="h-4 w-4" />
              Perks
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={has("custom") >= MAX_CUSTOM_SECTIONS}
              onClick={() => setSections([...sections, { id: newId(), kind: "custom", title: "", body: "", hidden: false }])}
            >
              <Plus className="h-4 w-4" />
              Custom section
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-lg border p-5">
          <h2 className="text-lg font-semibold tracking-tight">Links</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {LINK_KEYS.map((key) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`link-${key}`}>{LINK_LABELS[key]}</Label>
                <Input
                  id={`link-${key}`}
                  type="url"
                  placeholder="https://"
                  value={links[key] ?? ""}
                  onChange={(e) => {
                    const value = e.target.value.trim();
                    setLinks((current) => {
                      const next = { ...current };
                      if (value) next[key] = value;
                      else delete next[key];
                      return next;
                    });
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="brand"
            disabled={disabled || Boolean(accentProblem)}
            onClick={() =>
              void run(
                "save",
                () => saveCareersPageAction({ accentColor: accent.toLowerCase(), coverUrl, sections, links }),
                "Careers page saved.",
              )
            }
          >
            {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save careers page
          </Button>
        </div>
      </fieldset>

      <section aria-label="Preview" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Preview</h2>
        <div className="overflow-hidden rounded-2xl border">
          <CareersShell page={draft} embedded>
            <CareersHeader page={draft} />
            <CareersSections sections={draft.sections} about={draft.description} />
            <CareersJobs
              slug={savedSlug}
              initial={jobs}
              filters={parseCareersFilters(new URLSearchParams())}
              jobBasePath={`${careersPath(savedSlug)}/jobs`}
              preview
            />
          </CareersShell>
        </div>
      </section>
    </div>
  );
}
