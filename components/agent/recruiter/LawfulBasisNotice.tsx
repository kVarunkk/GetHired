/**
 * BI-REQ-016: approving an import or a hand-added person is the member's
 * attestation, so the card says so in the import page's words.
 */
export function LawfulBasisNotice({ input }: { input: unknown }) {
  const note = (input as { lawfulBasisNote?: unknown } | undefined)?.lawfulBasisNote;
  return (
    <p className="text-xs text-muted-foreground">
      By approving, you confirm we have a lawful basis to process these people&apos;s data and to contact them about
      roles{typeof note === "string" && note.trim() ? ` (${note.trim()})` : ""}. No one is emailed.
    </p>
  );
}
