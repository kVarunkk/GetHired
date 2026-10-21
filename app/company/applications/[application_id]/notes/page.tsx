import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import NotesPanel from "@/components/pipeline/NotesPanel";
import { loadApplicationFrame } from "@/helpers/applications/application-page";
import { listNotes } from "@/helpers/pipeline/notes";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notes",
};

/** An application's Notes section. */
export default async function ApplicationNotesPage({ params }: { params: Promise<{ application_id: string }> }) {
  try {
    const { application_id } = await params;
    const frame = await loadApplicationFrame(application_id);
    if (!frame) notFound();
    const { supabase, user, company } = frame;

    const [notes, { data: teammates }] = await Promise.all([
      listNotes({ supabase, company }, { applicationId: application_id }),
      // TM-REQ-009: who the notes composer can @mention. Empty without notes.write.
      supabase.rpc("list_mentionable_members"),
    ]);
    const mentionable = (teammates ?? [])
      .filter((m) => m.user_id !== user.id && m.name)
      .map((m) => ({ userId: m.user_id, name: m.name }));

    return (
      <div className="mb-20 flex flex-col gap-6">
        <SectionHeader title={`Notes (${notes.length})`} />
        <NotesPanel applicationId={application_id} notes={notes} currentUserId={user.id} members={mentionable} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
