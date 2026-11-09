import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DefaultChatTransport, type ChatInit, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import ChatPane, { buildChatRequest, chatErrorMessage, SUGGESTED_PROMPTS } from "./ChatPane";
import {
  AGENT_CONTENT_FILTER_MESSAGE,
  AGENT_DAILY_MESSAGE_CAP,
  AGENT_MAX_REGENERATIONS,
} from "@/helpers/agent/config";
import { submitAgentFeedbackAction } from "@/app/actions/submit-agent-feedback";

vi.mock("@ai-sdk/react", () => ({ useChat: vi.fn() }));
vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));
vi.mock("@/app/actions/submit-agent-feedback", () => ({
  submitAgentFeedbackAction: vi.fn(async () => ({ ok: true })),
  removeAgentFeedbackAction: vi.fn(async () => ({ ok: true })),
}));

const SESSION_ID = "55555555-5555-4555-8555-555555555555";

const text = (id: string, role: "user" | "assistant", value: string): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text: value }],
});

type ChatMock = ReturnType<typeof useChat>;
let chat: Partial<ChatMock>;

function mockChat(overrides: Partial<ChatMock> = {}) {
  chat = {
    messages: [],
    status: "ready",
    error: undefined,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn(),
    clearError: vi.fn(),
    addToolApprovalResponse: vi.fn(),
    addToolOutput: vi.fn(),
    ...overrides,
  };
  vi.mocked(useChat).mockReturnValue(chat as ChatMock);
}

const renderPane = (initialMessages: UIMessage[] = [], onFinish = vi.fn()) =>
  render(<ChatPane sessionId={SESSION_ID} initialMessages={initialMessages} onFinish={onFinish} />);

beforeEach(() => mockChat());

describe("buildChatRequest", () => {
  const messages = [text("u1", "user", "a"), text("a1", "assistant", "b")];

  it("sends only the latest message on submit", () => {
    expect(
      buildChatRequest(SESSION_ID)({ messages, trigger: "submit-message", messageId: undefined }),
    ).toEqual({
      body: {
        sessionId: SESSION_ID,
        trigger: "submit-message",
        messageId: undefined,
        message: messages[1],
      },
    });
  });

  it("sends no message on regenerate", () => {
    expect(
      buildChatRequest(SESSION_ID)({ messages, trigger: "regenerate-message", messageId: "a1" }),
    ).toEqual({ body: { sessionId: SESSION_ID, trigger: "regenerate-message", messageId: "a1" } });
  });
});

describe("chatErrorMessage", () => {
  it("uses the server's JSON error message", () => {
    expect(chatErrorMessage(new Error('{"error":"Limit reached."}'))).toBe("Limit reached.");
  });

  it("falls back to a generic message", () => {
    expect(chatErrorMessage(new Error("<html>502</html>"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("ChatPane", () => {
  it("configures useChat for this session", () => {
    const initial = [text("u1", "user", "hi")];
    renderPane(initial);

    const options = vi.mocked(useChat).mock.calls[0][0] as ChatInit<UIMessage>;
    expect(options).toMatchObject({ id: SESSION_ID, messages: initial });
    expect(options.transport).toBeInstanceOf(DefaultChatTransport);
    expect(options.sendAutomaticallyWhen).toBeTypeOf("function");
  });

  it("calls onFinish when a reply finishes", () => {
    const onFinish = vi.fn();
    renderPane([], onFinish);

    (vi.mocked(useChat).mock.calls[0][0] as ChatInit<UIMessage>).onFinish!({} as never);

    expect(onFinish).toHaveBeenCalled();
  });

  it("marks a stopped reply the way the server saves it", () => {
    const onFinish = vi.fn();
    renderPane([], onFinish);
    const options = vi.mocked(useChat).mock.calls[0][0] as ChatInit<UIMessage>;
    const partial: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Here are", state: "streaming" },
        { type: "tool-saveJob", toolCallId: "c1", state: "input-available", input: {} },
      ],
    } as UIMessage;
    const empty: UIMessage = { id: "a2", role: "assistant", parts: [{ type: "step-start" }] };

    options.onFinish!({ message: partial, isAbort: true } as never);
    const update = vi.mocked(chat.setMessages!).mock.calls[0][0] as (m: UIMessage[]) => UIMessage[];
    expect(update([text("u1", "user", "hi"), partial])).toEqual([
      text("u1", "user", "hi"),
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Here are", state: "done" }],
        metadata: { stopped: true },
      },
    ]);

    // A reply with nothing to show yet is removed, as the server doesn't save it.
    options.onFinish!({ message: empty, isAbort: true } as never);
    const remove = vi.mocked(chat.setMessages!).mock.calls[1][0] as (m: UIMessage[]) => UIMessage[];
    expect(remove([text("u1", "user", "hi"), empty])).toEqual([text("u1", "user", "hi")]);
    expect(onFinish).toHaveBeenCalledTimes(2);
  });

  it("leaves a finished reply alone", () => {
    renderPane();

    (vi.mocked(useChat).mock.calls[0][0] as ChatInit<UIMessage>).onFinish!({
      message: text("a1", "assistant", "done"),
      isAbort: false,
    } as never);

    expect(chat.setMessages).not.toHaveBeenCalled();
  });

  it("notes under a reply that it was stopped", () => {
    mockChat({
      messages: [
        text("u1", "user", "hi"),
        { ...text("a1", "assistant", "Here are"), metadata: { stopped: true } },
      ],
    });
    renderPane();

    expect(screen.getByText("Response stopped")).toBeInTheDocument();
  });

  describe("reply feedback (AF-REQ-001/002/005)", () => {
    const goodButtons = () => screen.queryAllByRole("button", { name: "Good response" });
    const conversation = [
      text("u1", "user", "find jobs"),
      text("a1", "assistant", "Here are three"),
      text("u2", "user", "more"),
      text("a2", "assistant", "Here are three more"),
    ];

    it("shows 👍/👎 on every finished reply, before Regenerate on the latest", () => {
      mockChat({ messages: conversation });
      renderPane();

      expect(goodButtons()).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Bad response" })).toHaveLength(2);
      const latest = screen.getByText("Here are three more").closest("div.flex.flex-col.gap-4")!;
      const buttons = within(latest as HTMLElement).getAllByRole("button").map((b) => b.textContent || b.getAttribute("aria-label"));
      expect(buttons.indexOf("Bad response")).toBeLessThan(buttons.indexOf("Regenerate"));
    });

    it("hides them on the reply that's streaming", () => {
      mockChat({ messages: conversation, status: "streaming" });
      renderPane();

      expect(goodButtons()).toHaveLength(1);
    });

    it("hides them on the content-filter message and a reply waiting on approval", () => {
      mockChat({
        messages: [
          text("u1", "user", "x"),
          text("a1", "assistant", AGENT_CONTENT_FILTER_MESSAGE),
          text("u2", "user", "apply"),
          {
            id: "a2",
            role: "assistant",
            parts: [
              { type: "text", text: "Shall I apply?" },
              {
                type: "tool-submitApplication",
                toolCallId: "c1",
                state: "approval-requested",
                input: {},
                approval: { id: "ap1" },
              },
            ],
          } as UIMessage,
        ],
      });
      renderPane();

      expect(goodButtons()).toHaveLength(0);
    });

    it("shows them on a stopped reply", () => {
      mockChat({
        messages: [text("u1", "user", "hi"), { ...text("a1", "assistant", "Here are"), metadata: { stopped: true } }],
      });
      renderPane();

      expect(goodButtons()).toHaveLength(1);
    });

    it("shows the saved vote pressed and saves a new one", async () => {
      mockChat({ messages: conversation });
      render(
        <ChatPane sessionId={SESSION_ID} initialMessages={[]} initialFeedback={{ a1: { reply: -1 } }} />,
      );

      const [firstDown, secondDown] = screen.getAllByRole("button", { name: "Bad response" });
      expect(firstDown).toHaveAttribute("aria-pressed", "true");
      expect(secondDown).toHaveAttribute("aria-pressed", "false");

      await userEvent.click(goodButtons()[1]);

      expect(submitAgentFeedbackAction).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        messageId: "a2",
        kind: "reply",
        rating: 1,
      });
      expect(goodButtons()[1]).toHaveAttribute("aria-pressed", "true");
    });

    it("shows the new session's votes after a switch", () => {
      const OTHER = "66666666-6666-4666-8666-666666666666";
      mockChat({ messages: conversation });
      const { rerender } = render(
        <ChatPane sessionId={SESSION_ID} initialMessages={[]} initialFeedback={{ a1: { reply: 1 } }} />,
      );
      expect(goodButtons()[0]).toHaveAttribute("aria-pressed", "true");

      rerender(<ChatPane sessionId={OTHER} initialMessages={[]} initialFeedback={{ a2: { reply: 1 } }} />);

      expect(goodButtons()[0]).toHaveAttribute("aria-pressed", "false");
      expect(goodButtons()[1]).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("the survey card (AF-REQ-013/014/016)", () => {
    const CARD = "How's the agent working for you?";
    const THANKS = "Thanks — this helps us improve the agent.";
    const withCard = (m: UIMessage, suggestions?: string[]): UIMessage => ({
      ...m,
      parts: [
        ...m.parts,
        ...(suggestions ? [{ type: "data-suggestions", id: "suggestions", data: { suggestions } }] : []),
        { type: "data-feedback", id: "feedback", data: { v: 1 } },
      ] as UIMessage["parts"],
    });
    const turns = (n: number) =>
      Array.from({ length: n }, (_, i) => [text(`u${i}`, "user", `q${i}`), text(`a${i}`, "assistant", `answer ${i}`)]).flat();

    it("shows the card under the reply that carries it, after the suggestions", () => {
      mockChat({ messages: [text("u1", "user", "apply"), withCard(text("a1", "assistant", "Applied!"), ["Track it"])] });
      renderPane();

      const card = screen.getByRole("region", { name: CARD });
      const chips = screen.getByRole("group", { name: "Suggested replies" });
      expect(chips.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("keeps an unanswered card for one more reply, then drops it", () => {
      const history = [text("u0", "user", "apply"), withCard(text("a0", "assistant", "Applied!"))];
      mockChat({ messages: [...history, ...turns(1).map((m) => ({ ...m, id: `x-${m.id}` }))] });
      const { unmount } = renderPane();
      expect(screen.getByRole("region", { name: CARD })).toBeInTheDocument();
      unmount();

      mockChat({ messages: [...history, ...turns(2).map((m) => ({ ...m, id: `x-${m.id}` }))] });
      renderPane();
      expect(screen.queryByRole("region", { name: CARD })).not.toBeInTheDocument();
    });

    it("restores a saved answer or dismissal on reload", () => {
      const old = [text("u0", "user", "apply"), withCard(text("a0", "assistant", "Applied!"))];
      mockChat({ messages: [...old, ...turns(3)] });
      const { unmount } = render(
        <ChatPane sessionId={SESSION_ID} initialMessages={[]} initialFeedback={{ a0: { survey: "answered" } }} />,
      );
      // Answered: the thanks line stays, however old.
      expect(screen.getByText(THANKS)).toBeInTheDocument();
      unmount();

      mockChat({ messages: old });
      render(<ChatPane sessionId={SESSION_ID} initialMessages={[]} initialFeedback={{ a0: { survey: "dismissed" } }} />);
      expect(screen.queryByRole("region", { name: CARD })).not.toBeInTheDocument();
      expect(screen.queryByText(THANKS)).not.toBeInTheDocument();
    });

    it("saves an answer into the chat's feedback state", async () => {
      mockChat({ messages: [text("u1", "user", "apply"), withCard(text("a1", "assistant", "Applied!"))] });
      renderPane();

      await userEvent.click(screen.getByRole("radio", { name: "Rate 5 out of 5" }));
      await userEvent.click(screen.getByRole("button", { name: "Submit" }));

      expect(submitAgentFeedbackAction).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: "a1", kind: "survey", rating: 5 }),
      );
      expect(await screen.findByText(THANKS)).toBeInTheDocument();
    });

    it("leaves the chips and the composer working while the card is open", async () => {
      mockChat({ messages: [text("u1", "user", "apply"), withCard(text("a1", "assistant", "Applied!"), ["Track it"])] });
      renderPane();
      expect(screen.getByRole("region", { name: CARD })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Track it" }));

      expect(chat.sendMessage).toHaveBeenCalledWith({ text: "Track it" });
      expect(screen.getByLabelText("Message")).toBeEnabled();
    });
  });

  it("shows suggested prompts when empty and sends one on click", async () => {
    renderPane();

    await userEvent.click(screen.getByRole("button", { name: SUGGESTED_PROMPTS[0] }));

    expect(chat.sendMessage).toHaveBeenCalledWith({ text: SUGGESTED_PROMPTS[0] });
  });

  it("renders the conversation", () => {
    mockChat({ messages: [text("u1", "user", "find jobs"), text("a1", "assistant", "Here you go")] });
    renderPane();

    expect(screen.getByText("find jobs")).toBeInTheDocument();
    expect(screen.getByText("Here you go")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SUGGESTED_PROMPTS[0] })).not.toBeInTheDocument();
  });

  it("sends with Enter and keeps Shift+Enter for new lines", async () => {
    renderPane();
    const input = screen.getByLabelText("Message");

    await userEvent.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(chat.sendMessage).not.toHaveBeenCalled();

    await userEvent.type(input, "{Enter}");
    expect(chat.sendMessage).toHaveBeenCalledWith({ text: "line one\nline two" });
    expect(input).toHaveValue("");
  });

  it("does not send blank messages", async () => {
    renderPane();

    await userEvent.type(screen.getByLabelText("Message"), "   {Enter}");

    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("disables the composer and offers Stop while streaming", async () => {
    mockChat({ status: "streaming", messages: [text("u1", "user", "hi")] });
    renderPane();

    expect(screen.getByLabelText("Message")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(chat.stop).toHaveBeenCalled();
  });

  it.each(["submitted", "streaming"] as const)(
    "shows a loader while the reply is %s",
    (status) => {
      mockChat({ status, messages: [text("u1", "user", "hi")] });
      renderPane();

      expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    },
  );

  it.each(["ready", "error"] as const)("hides the loader when %s", (status) => {
    mockChat({ status, messages: [text("u1", "user", "hi"), text("a1", "assistant", "done")] });
    renderPane();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  describe("suggested replies", () => {
    const withSuggestions = (id: string, value: string, suggestions: string[]): UIMessage => ({
      id,
      role: "assistant",
      parts: [
        { type: "text", text: value },
        { type: "data-suggestions", id: "suggestions", data: { suggestions } },
      ],
    });

    it("shows the last reply's suggestions and sends one on click", async () => {
      mockChat({
        messages: [
          text("u1", "user", "a"),
          withSuggestions("a1", "first", ["Old idea"]),
          text("u2", "user", "b"),
          withSuggestions("a2", "second", ["Only remote roles", "Save the first job"]),
        ],
      });
      renderPane();

      const group = screen.getByRole("group", { name: "Suggested replies" });
      expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
        "Only remote roles",
        "Save the first job",
      ]);
      expect(screen.queryByRole("button", { name: "Old idea" })).not.toBeInTheDocument();

      await userEvent.click(within(group).getByRole("button", { name: "Save the first job" }));
      expect(chat.sendMessage).toHaveBeenCalledWith({ text: "Save the first job" });
    });

    it("hides suggestions while a reply is in progress", () => {
      mockChat({
        status: "submitted",
        messages: [withSuggestions("a1", "first", ["Only remote roles"]), text("u2", "user", "b")],
      });
      renderPane();

      expect(screen.queryByRole("group", { name: "Suggested replies" })).not.toBeInTheDocument();
    });

    it("ignores malformed suggestion data", () => {
      mockChat({
        messages: [
          {
            id: "a1",
            role: "assistant",
            parts: [{ type: "data-suggestions", id: "suggestions", data: { suggestions: "nope" } }],
          } as UIMessage,
        ],
      });
      renderPane();

      expect(screen.queryByRole("group", { name: "Suggested replies" })).not.toBeInTheDocument();
    });
  });

  describe("scroll to latest", () => {
    /** Fakes the conversation's scroll metrics, which jsdom doesn't compute. */
    function scrollConversation(scrollTop: number) {
      const log = screen.getByRole("log", { name: "Conversation" });
      Object.defineProperty(log, "scrollHeight", { configurable: true, value: 1000 });
      Object.defineProperty(log, "clientHeight", { configurable: true, value: 400 });
      log.scrollTop = scrollTop;
      log.dispatchEvent(new Event("scroll"));
      return log;
    }

    it("appears when scrolled up and jumps to the newest message", async () => {
      mockChat({ messages: [text("u1", "user", "hi"), text("a1", "assistant", "hello")] });
      renderPane();
      expect(screen.queryByRole("button", { name: "Scroll to latest message" })).not.toBeInTheDocument();

      const log = scrollConversation(100);
      log.scrollTo = vi.fn();
      await userEvent.click(await screen.findByRole("button", { name: "Scroll to latest message" }));

      expect(log.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    });

    it("hides again near the bottom", async () => {
      mockChat({ messages: [text("u1", "user", "hi")] });
      renderPane();

      scrollConversation(100);
      expect(await screen.findByRole("button", { name: "Scroll to latest message" })).toBeInTheDocument();

      scrollConversation(560);
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Scroll to latest message" })).not.toBeInTheDocument(),
      );
    });
  });

  it("offers regenerate only on the last assistant message", async () => {
    mockChat({
      messages: [
        text("u1", "user", "a"),
        text("a1", "assistant", "first"),
        text("u2", "user", "b"),
        text("a2", "assistant", "second"),
      ],
    });
    renderPane();

    const buttons = screen.getAllByRole("button", { name: "Regenerate" });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    expect(chat.regenerate).toHaveBeenCalledWith({ messageId: "a2" });
  });

  it("counts the regeneration on the parent user message", async () => {
    mockChat({ messages: [text("u1", "user", "a"), text("a1", "assistant", "first")] });
    renderPane();

    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    const update = vi.mocked(chat.setMessages!).mock.calls[0][0] as (m: UIMessage[]) => UIMessage[];
    expect(update(chat.messages!)[0].metadata).toEqual({ regenerations: 1 });
  });

  it(`hides regenerate after ${AGENT_MAX_REGENERATIONS} regenerations`, () => {
    mockChat({
      messages: [
        { ...text("u1", "user", "a"), metadata: { regenerations: AGENT_MAX_REGENERATIONS } },
        text("a1", "assistant", "first"),
      ],
    });
    renderPane();

    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();
  });

  it("hides regenerate once today's messages are used up", () => {
    mockChat({ messages: [text("u1", "user", "a"), text("a1", "assistant", "first")] });
    render(
      <ChatPane
        sessionId={SESSION_ID}
        initialMessages={[]}
        messagesUsedToday={AGENT_DAILY_MESSAGE_CAP}
      />,
    );

    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();
  });

  it("hides regenerate as soon as the last message of the day is sent", async () => {
    mockChat({ messages: [text("u1", "user", "a"), text("a1", "assistant", "first")] });
    render(
      <ChatPane
        sessionId={SESSION_ID}
        initialMessages={[]}
        messagesUsedToday={AGENT_DAILY_MESSAGE_CAP - 1}
      />,
    );
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox"), "one more{Enter}");

    expect(chat.sendMessage).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();
  });

  it("shows the server's error, e.g. the daily cap", () => {
    mockChat({
      error: new Error(
        JSON.stringify({ error: "You've reached today's limit of 20 messages. Try again tomorrow." }),
      ),
    });
    renderPane();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You've reached today's limit of 20 messages. Try again tomorrow.",
    );
  });

  it("passes approvals and upload results to useChat", async () => {
    mockChat({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-submitApplication",
              toolCallId: "c1",
              state: "approval-requested",
              input: {},
              approval: { id: "ap1" },
            },
            { type: "tool-requestResumeUpload", toolCallId: "c-up", state: "input-available", input: {} },
          ],
        } as UIMessage,
      ],
    });
    renderPane();

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(chat.addToolApprovalResponse).toHaveBeenCalledWith({ id: "ap1", approved: true });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(chat.addToolOutput).toHaveBeenCalledWith({
      tool: "requestResumeUpload",
      toolCallId: "c-up",
      output: { cancelled: true },
    });
  });
});
