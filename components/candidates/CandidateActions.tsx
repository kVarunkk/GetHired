"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { deleteCandidatesAction } from "@/app/actions/candidates/delete-candidates";
import AddCandidatesToJobDialog from "@/components/candidates/AddCandidatesToJobDialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";

/**
 * The candidate page's header actions: add to a job (BI-REQ-005, disabled
 * without an email) and delete (BI-REQ-007), each shown only when allowed.
 */
export default function CandidateActions({
  candidate,
  jobs,
  canDelete,
  listHref,
}: {
  candidate: { id: string; name: string; email: string | null };
  /** Jobs they can still be added to. Empty hides the button. */
  jobs: { id: string; title: string }[];
  canDelete: boolean;
  /** Where to go after a delete. */
  listHref: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    const result = await deleteCandidatesAction({ candidateIds: [candidate.id] });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Candidate deleted.");
    router.push(listHref);
  };

  return (
    <>
      {jobs.length > 0 && (
        // A disabled button gets no hover, so the reason sits on its wrapper.
        <span title={candidate.email ? undefined : "Add an email first"}>
          <Button variant="outline" disabled={!candidate.email} onClick={() => setAdding(true)}>
            <BriefcaseBusiness className="mr-2 h-4 w-4" />
            Add to a job
          </Button>
        </span>
      )}
      {canDelete && (
        <Button variant="outline" onClick={() => setDeleting(true)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      )}

      <AddCandidatesToJobDialog open={adding} onOpenChange={setAdding} candidateIds={[candidate.id]} jobs={jobs} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${candidate.name}?`}
        description="Their imported applications, notes and list memberships go too. If they connected a GetHired account, they keep their applications. This can't be undone."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
    </>
  );
}
