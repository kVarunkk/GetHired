import { Badge } from "@/components/ui/badge";
import {
  QUESTION_TYPE_LABELS,
  STANDARD_FIELDS,
  STANDARD_FIELD_KEYS,
  applicationFormSchema,
  type FormQuestion,
  type KnockoutRule,
} from "@/helpers/jobs/application-form-schema";

/** The tools whose approval card shows the form they save. */
export const FORM_APPROVAL_TOOLS = ["createJobPost", "updateJobPost", "saveQuestionSet"];

/** "Answers No → rejects the application." */
function describeKnockout({ fail_if, action }: KnockoutRule) {
  const when =
    fail_if.kind === "equals"
      ? `Answers ${fail_if.value ? "Yes" : "No"}`
      : fail_if.kind === "any_of"
        ? `Picks ${fail_if.options.join(" or ")}`
        : fail_if.kind === "less_than"
          ? `Answers less than ${fail_if.value}`
          : `Answers more than ${fail_if.value}`;
  return `${when} → ${action === "reject" ? "rejects" : "flags"} the application`;
}

function QuestionItem({ question, index }: { question: FormQuestion; index: number }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border bg-background p-2.5">
      <div className="flex gap-2">
        <span className="shrink-0 text-muted-foreground">{index + 1}.</span>
        <span className="min-w-0 break-words font-medium text-foreground">{question.label}</span>
      </div>
      <div className="flex flex-wrap gap-1 pl-5">
        <Badge variant="secondary" className="font-normal">
          {QUESTION_TYPE_LABELS[question.type]}
        </Badge>
        <Badge variant="outline" className="font-normal">
          {question.required ? "Required" : "Optional"}
        </Badge>
      </div>
      {question.help_text && <p className="pl-5 text-muted-foreground">{question.help_text}</p>}
      {question.options && question.options.length > 0 && (
        <p className="break-words pl-5 text-muted-foreground">Options: {question.options.join(" · ")}</p>
      )}
      {question.knockout && (
        <p className="pl-5 text-muted-foreground">Knockout: {describeKnockout(question.knockout)}</p>
      )}
    </li>
  );
}

/**
 * The application form an agent tool saves, for its approval card (AF-REQ-009):
 * each question on its own row with its type, whether it's required, its
 * options and knockout rule, then the standard fields it turns on.
 */
export function ApplicationFormApprovalDetails({ input }: { input: unknown }) {
  const values = (input ?? {}) as { applicationForm?: unknown; questions?: unknown };

  if (values.applicationForm !== undefined) {
    const parsed = applicationFormSchema.safeParse(values.applicationForm);
    if (!parsed.success) {
      return <p className="text-xs text-destructive">The application form doesn&apos;t validate yet.</p>;
    }
    const form = parsed.data;
    const questions = form.questions.filter((q) => !q.archived);
    const standard = STANDARD_FIELD_KEYS.filter((k) => form.standard_fields[k] && form.standard_fields[k] !== "off");
    const authKnockout = form.standard_knockouts?.work_authorization;

    return (
      <div className="flex flex-col gap-2 text-xs">
        <p className="font-medium text-muted-foreground">Application form</p>
        {questions.length > 0 ? (
          <ol className="flex flex-col gap-1.5">
            {questions.map((q, i) => (
              <QuestionItem key={q.id} question={q} index={i} />
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground">No questions.</p>
        )}
        {standard.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-medium text-muted-foreground">Standard fields</p>
            <ul className="flex flex-col gap-0.5">
              {standard.map((k) => (
                <li key={k} className="text-foreground">
                  {STANDARD_FIELDS[k].label}{" "}
                  <span className="text-muted-foreground">
                    ({form.standard_fields[k]}
                    {k === "work_authorization" && authKnockout && `; knockout: ${describeKnockout(authKnockout)}`})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // Plain-text questions: each one is required, with a long answer.
  if (Array.isArray(values.questions) && values.questions.length > 0) {
    return (
      <div className="flex flex-col gap-2 text-xs">
        <p className="font-medium text-muted-foreground">Screening questions (required, long answer)</p>
        <ol className="flex flex-col gap-1.5">
          {values.questions.map((q, i) => (
            <li key={i} className="flex gap-2 rounded-lg border bg-background p-2.5">
              <span className="shrink-0 text-muted-foreground">{i + 1}.</span>
              <span className="min-w-0 break-words text-foreground">{String(q)}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return null;
}
