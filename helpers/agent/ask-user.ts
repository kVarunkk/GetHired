import { z } from "zod";

/**
 * The agents' `askUser` client tool: the model asks one to four questions and
 * the chat shows them as a card with choices. Client-safe, so the card, the
 * tool and the server's output check share one definition.
 */

export const ASK_USER_MAX_QUESTIONS = 4;
export const ASK_USER_MAX_OPTIONS = 6;
export const ASK_USER_OTHER_MAX_CHARS = 500;
export const ASK_USER_MAX_LOCATIONS = 20;
export const ASK_USER_LOCATION_MAX_CHARS = 100;

const option = z.object({
  label: z.string().trim().min(1).max(80).describe("The choice, in a few words."),
  description: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Optional line under the choice explaining what it means."),
});

const question = z.object({
  question: z.string().trim().min(3).max(300).describe("The question, ending with a question mark."),
  options: z
    .array(option)
    .min(2)
    .max(ASK_USER_MAX_OPTIONS)
    .optional()
    .describe(
      "2 to 6 choices, each different. The user can always type their own answer instead. Omit for a question only they can answer in their own words (e.g. a number or a name).",
    ),
  multiSelect: z
    .boolean()
    .optional()
    .describe(
      "True when the user may pick more than one choice. Set it whenever the answer fills a list (job titles or desired roles, skills, job types, work styles) or more than one choice could apply; leave it out only when exactly one answer makes sense (which job, which resume).",
    ),
  kind: z
    .enum(["locations"])
    .optional()
    .describe(
      'Set to "locations" for any question whose answer is a place (preferred locations, where to search, where a job is based). The card then shows the app\'s location search, so the user picks one or more real city and country names. Leave out options.',
    ),
});

export const askUserInputSchema = z.object({
  questions: z
    .array(question)
    .min(1)
    .max(ASK_USER_MAX_QUESTIONS)
    .describe("1 to 4 questions, shown together on one card."),
});

export type AskUserInput = z.infer<typeof askUserInputSchema>;
export type AskUserQuestion = AskUserInput["questions"][number];

/**
 * What the card hands back: per question, the indexes of the chosen options
 * and the user's own words, if they typed any. Indexes, not labels, so the
 * labels the model reads come from the stored input.
 */
export const askUserOutputSchema = z.union([
  z
    .object({
      answers: z
        .array(
          z
            .object({
              selected: z.array(z.number().int().min(0).max(ASK_USER_MAX_OPTIONS - 1)).max(ASK_USER_MAX_OPTIONS),
              other: z.string().trim().min(1).max(ASK_USER_OTHER_MAX_CHARS).optional(),
              locations: z
                .array(z.string().trim().min(1).max(ASK_USER_LOCATION_MAX_CHARS))
                .min(1)
                .max(ASK_USER_MAX_LOCATIONS)
                .optional(),
            })
            .strict(),
        )
        .min(1)
        .max(ASK_USER_MAX_QUESTIONS),
    })
    .strict(),
  z.object({ dismissed: z.literal(true) }).strict(),
]);

export type AskUserOutput = z.infer<typeof askUserOutputSchema>;
export type AskUserAnswer = Extract<AskUserOutput, { answers: unknown }>["answers"][number];

/** Whether a question is answered with the location search, not choices. */
export const isLocationQuestion = (q: AskUserQuestion) => q.kind === "locations";

/** Whether one answer is complete for its question. Pure. */
export function answerComplete(q: AskUserQuestion, answer: AskUserAnswer | undefined): boolean {
  if (!answer) return false;
  const locations = answer.locations ?? [];
  // A location question takes places picked from the search only: no choices, no typed text.
  // It's always multi-select, whatever multiSelect says.
  if (isLocationQuestion(q)) {
    if (answer.selected.length > 0 || answer.other) return false;
    const unique = new Set(locations.map((l) => l.toLowerCase()));
    return unique.size === locations.length && locations.length >= 1;
  }
  if (locations.length > 0) return false;
  const options = q.options ?? [];
  const picked = new Set(answer.selected);
  if (picked.size !== answer.selected.length) return false;
  if (answer.selected.some((index) => index >= options.length)) return false;
  const count = answer.selected.length + (answer.other ? 1 : 0);
  if (options.length === 0) return answer.selected.length === 0 && Boolean(answer.other);
  return q.multiSelect ? count >= 1 : count === 1;
}

/**
 * Whether an output answers exactly these questions, every one of them.
 * The server checks it against the stored input before saving.
 */
export function outputFitsInput(input: unknown, output: AskUserOutput): boolean {
  if ("dismissed" in output) return true;
  const parsed = askUserInputSchema.safeParse(input);
  if (!parsed.success) return false;
  const { questions } = parsed.data;
  return (
    output.answers.length === questions.length &&
    questions.every((q, i) => answerComplete(q, output.answers[i]))
  );
}

/** One answer in words: the chosen labels, then what the user typed. */
export function answerLabels(q: AskUserQuestion, answer: AskUserAnswer): string[] {
  if (answer.locations) return answer.locations;
  const labels = answer.selected.map((index) => q.options?.[index]?.label).filter((l): l is string => Boolean(l));
  return answer.other ? [...labels, answer.other] : labels;
}

/**
 * What the model reads once the user answered or closed the card. It runs on
 * the stored history every turn, so an output of another shape (a context
 * stub is a string) must never throw: that would fail every message after it.
 */
export function askUserResultForModel(input: unknown, output: unknown): string {
  if (typeof output === "string") return output;
  const result = askUserOutputSchema.safeParse(output);
  if (!result.success) return "The card didn't report the user's answers. Ask again if you still need them.";
  if ("dismissed" in result.data) {
    return "The user closed the questions without answering. Don't ask them again in this reply: carry on with what you know, or ask in a sentence if you must.";
  }
  const parsed = askUserInputSchema.safeParse(input);
  const { answers } = result.data;
  if (!parsed.success) return "The user answered, but the questions couldn't be read.";

  const lines = parsed.data.questions.map((q, i) => {
    const answer = answers[i];
    if (!answer) return `${i + 1}. ${q.question}\n   (no answer)`;
    if (answer.locations) {
      const places = answer.locations.map((l) => `"${l}"`).join("; ");
      return `${i + 1}. ${q.question}\n   The user picked these locations from the location search: ${places}`;
    }
    const chosen = answer.selected
      .map((index) => q.options?.[index]?.label)
      .filter(Boolean)
      .join("; ");
    const parts = [
      chosen && `chose: ${chosen}`,
      answer.other && `in their own words: "${answer.other}"`,
    ].filter(Boolean);
    return `${i + 1}. ${q.question}\n   The user ${parts.join(", and ")}`;
  });
  return `The user answered your questions:\n${lines.join("\n")}`;
}
