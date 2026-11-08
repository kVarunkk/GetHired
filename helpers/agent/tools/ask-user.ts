import { tool } from "ai";
import {
  askUserInputSchema,
  askUserOutputSchema,
  askUserResultForModel,
} from "../ask-user";

/**
 * `askUser`, shared by both agent roles. It has no `execute`: the chat shows
 * the questions as a card and the user's answers are its output, checked
 * against the stored questions by `mergeClientUpdates`.
 */
export function createAskUserTool() {
  return {
    askUser: tool({
      description:
        "Ask the user 1 to 4 short questions on a card in the chat, each with 2 to 6 choices to click (the user can always type their own answer instead), or with no choices for a free answer. Use it when you need the user to choose before you can go on, e.g. which job, which resume, where imported people go, or a preference with a few clear options. Don't use it for a simple yes or no, to confirm an action that already asks for approval, or for questions you can answer from tools. Call it as the last thing in your reply and don't repeat the questions in text: the result is the user's answers, or that they closed the card. Free.",
      inputSchema: askUserInputSchema,
      outputSchema: askUserOutputSchema,
      toModelOutput: ({ input, output }) => ({
        type: "text",
        value: askUserResultForModel(input, output),
      }),
    }),
  };
}
