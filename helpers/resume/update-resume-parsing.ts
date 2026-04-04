import { createClient } from "@/lib/supabase/server";

export const updateResumeParsingStatus = async (
  parsingFailed: boolean,
  resumeId: string,
) => {
  const supabase = await createClient();

  await supabase
    .from("resumes")
    .update({
      parsing_failed: parsingFailed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", resumeId);
};
