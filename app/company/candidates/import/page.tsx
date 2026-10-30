import { redirect } from "next/navigation";
import { candidateImportPath } from "@/helpers/candidates/paths";

/** The import opens on Resumes (CP-DEC-004). */
export default function ImportCandidatesPage() {
  redirect(candidateImportPath());
}
