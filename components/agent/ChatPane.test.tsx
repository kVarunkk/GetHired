import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DefaultChatTransport, type ChatInit, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import ChatPane, { buildChatRequest, chatErrorMessage, SUGGESTED_PROMPTS } from "./ChatPane";

vi.mock("@ai-sdk/react", () => ({ useChat: vi.fn() }));
vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));

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
              type: "tool-startResumeReview",
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
