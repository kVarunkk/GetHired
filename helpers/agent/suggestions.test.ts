import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { generateFollowUps } from "./suggestions";
import { mockGenerateModel } from "@/test/utils/ai";

const promptOf = (model: MockLanguageModelV4) => JSON.stringify(model.doGenerateCalls[0].prompt);

describe("generateFollowUps", () => {
  it("returns up to 3 trimmed, distinct suggestions", async () => {
    const model = mockGenerateModel(
      JSON.stringify({
        suggestions: [
          "  Only remote roles  ",
          "Only remote roles",
          "",
          "Save the first job",
          "Review my resume for it",
          "Show more jobs",
        ],
      }),
    );

    expect(
      await generateFollowUps(
        { userText: "find react jobs", replyText: "Here are 5 React jobs." },
        { model },
      ),
    ).toEqual(["Only remote roles", "Save the first job", "Review my resume for it"]);
  });

  it("caps each suggestion's length", async () => {
    const model = mockGenerateModel(JSON.stringify({ suggestions: ["x".repeat(200)] }));

    const [suggestion] = await generateFollowUps({ userText: "a", replyText: "b" }, { model });

    expect(suggestion).toHaveLength(80);
  });

  it("sends the user's message and the reply as sandboxed data", async () => {
    const model = mockGenerateModel(JSON.stringify({ suggestions: [] }));

    await generateFollowUps(
      { userText: "find react jobs", replyText: "Here are 5 React jobs." },
      { model },
    );

    const prompt = promptOf(model);
    expect(prompt).toContain("<user_message>\\nfind react jobs\\n</user_message>");
    expect(prompt).toContain("<assistant_reply>\\nHere are 5 React jobs.\\n</assistant_reply>");
  });

  it("skips the model when the reply has no text", async () => {
    const model = mockGenerateModel("unused");

    expect(await generateFollowUps({ userText: "hi", replyText: "  " }, { model })).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it.each([
    ["the model fails", () =>
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error("model down");
        },
      })],
    ["the output isn't valid", () => mockGenerateModel("not json")],
  ])("returns no suggestions when %s", async (_label, makeModel) => {
    expect(
      await generateFollowUps({ userText: "a", replyText: "b" }, { model: makeModel() }),
    ).toEqual([]);
  });
});

describe("generateFollowUps telemetry (REQ-025)", () => {
  it("passes its telemetry options to the model call", async () => {
    const integration = { onStart: vi.fn() };

    await generateFollowUps(
      { userText: "a", replyText: "b" },
      {
        model: mockGenerateModel(JSON.stringify({ suggestions: [] })),
        telemetry: { functionId: "agent-suggestions", integrations: [integration] },
      },
    );

    expect(integration.onStart).toHaveBeenCalledWith(
      expect.objectContaining({ functionId: "agent-suggestions" }),
    );
  });

  it("suggests a job seeker's next steps by default and a recruiter's for companies", async () => {
    const applicant = mockGenerateModel(JSON.stringify({ suggestions: [] }));
    await generateFollowUps({ userText: "a", replyText: "b" }, { model: applicant });
    expect(promptOf(applicant)).toContain("job seeker");
    expect(promptOf(applicant)).not.toContain("recruiter");

    const recruiter = mockGenerateModel(JSON.stringify({ suggestions: [] }));
    await generateFollowUps({ userText: "a", replyText: "b" }, { model: recruiter, role: "company" });
    const prompt = promptOf(recruiter);
    expect(prompt).toContain("recruiter");
    expect(prompt).toContain("candidates");
    expect(prompt).not.toContain("job seeker");
  });
});
