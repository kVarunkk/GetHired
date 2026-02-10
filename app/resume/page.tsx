import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import { IResume } from "@/lib/types";
import ResumesTable from "@/components/ResumesTable";
import CreateResumeDialog from "@/components/CreateResumeDialog";

export default async function ResumePage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const { data: resumes, error: resumesError } = await supabase
      .from("resumes")
      .select("id, created_at, name, is_primary")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (resumesError) {
      throw resumesError;
    }

    return (
      <div className="flex flex-col w-full gap-8 p-4 mb-20">
        <div className="flex items-center justify-between flex-wrap gap-4 w-full">
          <h1 className="text-3xl font-medium ">All Resumes</h1>
          <CreateResumeDialog
            userId={user.id}
            existingResumes={(resumes as unknown as IResume[]) ?? []}
          />
        </div>
        <ResumesTable data={(resumes as unknown as IResume[]) || []} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
