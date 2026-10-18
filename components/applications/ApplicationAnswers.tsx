import type { AnswerView } from "@/helpers/applications/answers-view";

/** AF-REQ-008: an application's answers, label → value, as plain text (AF-SEC-002). */
export default function ApplicationAnswers({ answers }: { answers: AnswerView[] }) {
  if (answers.length === 0) {
    return <p className="text-muted-foreground">No custom questions were asked for this job.</p>;
  }
  return (
    <dl className="space-y-4">
      {answers.map((answer) => (
        <div key={answer.key}>
          <dt className="text-sm font-semibold">{answer.label}</dt>
          <dd className="whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {answer.text === null ? (
              <span className="italic">Not answered</span>
            ) : answer.url ? (
              <a href={answer.url} target="_blank" rel="nofollow noopener noreferrer ugc" className="underline underline-offset-4">
                {answer.text}
              </a>
            ) : (
              answer.text
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
