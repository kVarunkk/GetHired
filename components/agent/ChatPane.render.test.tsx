import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import ChatPane from "./ChatPane";

vi.mock("@ai-sdk/react", () => ({ useChat: vi.fn() }));

// Counts renders of each message. vi.hoisted so the mock factory can reach it.
const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock("./MessageParts", async () => {
  const { memo } = await import("react");
  return {
    default: memo(function MessageParts({ message }: { message: UIMessage }) {
      renders.count += 1;
      return <p>{message.id}</p>;
    }),
    StepNode: () => null,
  };
});

const text = (id: string, role: "user" | "assistant", value: string): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text: value }],
});

describe("ChatPane rendering", () => {
  it("does not re-render messages while the user types", async () => {
    const messages = [text("u1", "user", "hi"), text("a1", "assistant", "hello")];
    vi.mocked(useChat).mockReturnValue({
      messages,
      status: "ready",
      error: undefined,
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      addToolApprovalResponse: vi.fn(),
      addToolOutput: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(<ChatPane sessionId="s1" initialMessages={messages} />);
    const afterMount = renders.count;

    await userEvent.type(screen.getByLabelText("Message"), "remote react jobs");

    expect(renders.count).toBe(afterMount);
  });
});
