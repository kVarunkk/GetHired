import { notFound, unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import Error from "@/components/Error";
import KitScorecard from "@/components/interviews/kit/KitScorecard";
import SectionHeader from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { loadKitFrame } from "@/helpers/interviews/kit-page";

export const metadata: Metadata = {
  title: "Guide",
};

/**
 * The kit's index: the instructions and what to assess. Once the kit has
 * closed, the member's submitted scorecard, the only thing left in it.
 */
export default async function InterviewKitGuidePage({ params }: { params: Promise<{ interview_id: string }> }) {
  try {
    const { interview_id } = await params;
    const frame = await loadKitFrame(interview_id);
    // The layout renders a missing or expired kit.
    if (!frame || !frame.result.ok) notFound();
    const { kit } = frame.result;

    if (kit.access === "scorecard_only") {
      return (
        <>
          <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
            The kit has closed. Your submitted scorecard is below.
          </p>
          <SectionHeader title="Your scorecard" />
          <KitScorecard kit={kit} />
        </>
      );
    }

    const { instructions, competencies } = kit.interview;
    return (
      <>
        <SectionHeader
          title="Guide"
          description="How to run this interview and what to assess."
          actions={
            <Button asChild variant="outline">
              <Link href={`${frame.base}/scorecard`}>Open scorecard</Link>
            </Button>
          }
        />

        {instructions && (
          <section className="flex flex-col gap-3">
            <h3 className="text-base font-semibold tracking-tight">Instructions</h3>
            <p className="whitespace-pre-wrap text-[15px] leading-7 [overflow-wrap:anywhere]">{instructions}</p>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h3 className="text-base font-semibold tracking-tight">What to assess</h3>
          {competencies.length > 0 ? (
            <div className="divide-y rounded-xl border">
              {competencies.map((c) => (
                <div key={c.id} className="flex flex-col gap-1 px-4 py-3">
                  <p className="text-sm font-medium">{c.name}</p>
                  {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
                  {c.questions.length > 0 && (
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                      {c.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No competencies for this interview.</p>
          )}
        </section>
      </>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
