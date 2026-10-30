"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const IMPORT_LAWFUL_BASIS_TEXT =
  "We have a lawful basis to process these people's data and to contact them about roles.";

/**
 * BI-REQ-016: the attestation an import needs before it's confirmed, with an
 * optional note on the basis. Stored on the batch with the member and time.
 */
export default function LawfulBasisCheck({
  attested,
  onAttestedChange,
  note,
  onNoteChange,
  disabled = false,
  idPrefix = "import",
}: {
  attested: boolean;
  onAttestedChange: (attested: boolean) => void;
  note: string;
  onNoteChange: (note: string) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Checkbox
          id={`${idPrefix}-attest`}
          checked={attested}
          onCheckedChange={(value) => onAttestedChange(value === true)}
          disabled={disabled}
        />
        <Label htmlFor={`${idPrefix}-attest`} className="font-normal leading-snug">
          {IMPORT_LAWFUL_BASIS_TEXT}
        </Label>
      </div>
      <div className="flex flex-col gap-2 sm:max-w-md">
        <Label htmlFor={`${idPrefix}-basis`}>Basis (optional)</Label>
        <Input
          id={`${idPrefix}-basis`}
          value={note}
          maxLength={200}
          placeholder="Applied by email, consented in our previous ATS…"
          onChange={(e) => onNoteChange(e.target.value)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
