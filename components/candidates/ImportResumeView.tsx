"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import toast from "react-hot-toast";
import { importRowFileUrlAction } from "@/app/actions/candidates/import-row-file-url";
import ResumePreviewDialog from "@/components/ResumePreviewDialog";
import { resumeExtensionOf } from "@/helpers/candidates/resume-files";

const isPdf = (name: string) => resumeExtensionOf(name) === "pdf";

/**
 * View a resume chosen for import, before it's uploaded. A PDF opens in the
 * resume viewer from a local object URL, made when the dialog opens and
 * revoked when it closes. Browsers can't show a Word file, so there's nothing
 * to view for one.
 */
export function LocalResumeView({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  const current = useRef<string | null>(null);

  const release = () => {
    if (current.current) URL.revokeObjectURL(current.current);
    current.current = null;
  };
  useEffect(() => release, []);

  if (!isPdf(file.name)) return null;
  return (
    <ResumePreviewDialog
      displayUrl={url}
      title={file.name}
      triggerLabel={`View ${file.name}`}
      onOpenChange={(open) => {
        release();
        if (open) {
          current.current = URL.createObjectURL(file);
          setUrl(current.current);
        } else {
          setUrl("");
        }
      }}
    />
  );
}

/**
 * View (a PDF) or download (a Word file) a resume already uploaded to an
 * import batch, through a short-lived signed link fetched on click.
 */
export function ImportRowResumeView({ rowId, fileName }: { rowId: string; fileName: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchUrl = async () => {
    const res = await importRowFileUrlAction({ rowId }).catch(() => null);
    if (!res?.ok) {
      toast.error(res?.error ?? "Couldn't open the resume. Try again.");
      return null;
    }
    return res.url;
  };

  if (!isPdf(fileName)) {
    return (
      <button
        type="button"
        disabled={busy}
        aria-label={`Download ${fileName}`}
        className="inline-flex items-center gap-1 text-xs font-medium underline-offset-4 transition-colors hover:text-brand hover:underline disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          const signed = await fetchUrl();
          setBusy(false);
          if (signed) window.location.assign(signed);
        }}
      >
        <Download className="h-3 w-3" aria-hidden />
        Download
      </button>
    );
  }

  return (
    <span className="text-xs">
      <ResumePreviewDialog
        displayUrl={url}
        title={fileName}
        triggerLabel={`View ${fileName}`}
        onOpenChange={(open) => {
          if (!open) return setUrl("");
          void fetchUrl().then((signed) => signed && setUrl(signed));
        }}
      />
    </span>
  );
}
