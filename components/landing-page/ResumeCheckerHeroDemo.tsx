"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Step } from "@/components/agent/MessageParts";
import { ChangesForm, type ResumeChangesOutput } from "@/components/agent/ResumeChangesCard";
import { Button } from "@/components/ui/button";
import AgentHeroDemo from "./AgentHeroDemo";
import { DEMO_VIEW, RESUME_DEMO, demoApply } from "./resume-checker-demo";

// The AI resume checker's hero: the agent tailoring a resume to a job. It is
// AgentHeroDemo with the agent's own changes card (ChangesForm, the form inside
// ResumeChangesCard) under the reply, fed a canned review. Ticking, editing,
// filling in values and the live diff (with the whole resume in a side sheet)
// all work as in the chat. Apply runs locally: nothing is saved and no server
// action is called.

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function DemoResult({ output, onReset }: { output: ResumeChangesOutput; onReset: () => void }) {
  const toCopy = output.targetResumeId === "demo-copy";
  return (
    <div className="flex flex-col items-start gap-2 text-xs">
      {output.status === "applied" ? (
        <p className="text-foreground">
          Applied {count(output.applied.length, "change")} to{" "}
          {toCopy ? "a copy of your resume. Your original stays as it was." : "your resume."}
          {output.skipped.length > 0 && ` ${count(output.skipped.length, "change")} not applied.`}
        </p>
      ) : (
        <p className="text-muted-foreground">Nothing was changed.</p>
      )}
      <Button type="button" variant="outline" size="sm" onClick={onReset}>
        <RotateCcw className="h-3.5 w-3.5" />
        Try it again
      </Button>
    </div>
  );
}

export default function ResumeCheckerHeroDemo() {
  const [output, setOutput] = useState<ResumeChangesOutput | null>(null);
  // A new key remounts the form, so "Try it again" starts from the review.
  const [run, setRun] = useState(0);

  return (
    <AgentHeroDemo demo={RESUME_DEMO}>
      <ol className="flex flex-col gap-3">
        {output ? (
          <Step tone="done" label="Reviewed the changes">
            <DemoResult
              output={output}
              onReset={() => {
                setOutput(null);
                setRun((current) => current + 1);
              }}
            />
          </Step>
        ) : (
          <Step tone="yours" label="Choose your changes">
            <ChangesForm
              key={run}
              view={DEMO_VIEW}
              applyChanges={demoApply}
              onDone={setOutput}
              onReload={() => {}}
            />
          </Step>
        )}
      </ol>
    </AgentHeroDemo>
  );
}
