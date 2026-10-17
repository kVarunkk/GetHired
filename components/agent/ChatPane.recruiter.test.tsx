import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import ChatPane, { SUGGESTED_PROMPTS } from "./ChatPane";
import MemoriesPanel from "./MemoriesPanel";
import { AGENT_ROLE_UI } from "./roles";
import { RA_DAILY_MESSAGE_CAP } from "@/helpers/agent/roles/recruiter/config";
import { AGENT_DAILY_MESSAGE_CAP } from "@/helpers/agent/config";

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
    setMessages: vi.fn(),
    clearError: vi.fn(),
    addToolApprovalResponse: vi.fn(),
    addToolOutput: vi.fn(),
    ...overrides,
  };
  vi.mocked(useChat).mockReturnValue(chat as ChatMock);
}

beforeEach(() => mockChat());

describe("ChatPane for a company user (RAT-018, RA-REQ-001)", () => {
  it("shows the recruiter's empty state and starters", async () => {
    render(<ChatPane role="company" sessionId={SESSION_ID} initialMessages={[]} />);

    expect(screen.getByRole("heading", { name: AGENT_ROLE_UI.company.heading })).toBeInTheDocument();
    expect(AGENT_ROLE_UI.company.starters).toEqual([
      "Find candidates for my latest job",
      "Who are the strongest applicants this week?",
      "Write a job post for a founding engineer",
      "Where is each role stuck?",
    ]);
    for (const prompt of SUGGESTED_PROMPTS) {
      expect(screen.queryByRole("button", { name: prompt })).not.toBeInTheDocument();
    }

    await userEvent.click(screen.getByRole("button", { name: "Find candidates for my latest job" }));
    expect(chat.sendMessage).toHaveBeenCalledWith({ text: "Find candidates for my latest job" });
  });

  it("keeps the applicant's starters by default", () => {
    render(<ChatPane sessionId={SESSION_ID} initialMessages={[]} />);

    expect(screen.getByRole("button", { name: SUGGESTED_PROMPTS[0] })).toBeInTheDocument();
    expect(AGENT_ROLE_UI.applicant.starters).toBe(SUGGESTED_PROMPTS);
  });

  it(`uses the recruiter's daily cap of ${RA_DAILY_MESSAGE_CAP}`, () => {
    mockChat({ messages: [text("u1", "user", "a"), text("a1", "assistant", "first")] });
    render(
      <ChatPane
        role="company"
        sessionId={SESSION_ID}
        initialMessages={[]}
        messagesUsedToday={AGENT_DAILY_MESSAGE_CAP}
      />,
    );
    // Past the applicant cap, still under the recruiter's.
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });
});

describe("ChatPane's per-member cap hint (RP-REQ-044)", () => {
  it("shows the member's agent messages left this month, counting what they send", async () => {
    render(
      <ChatPane role="company" sessionId={SESSION_ID} initialMessages={[]} memberCap={{ limit: 50, remaining: 3 }} />,
    );
    expect(screen.getByText("3 of your 50 agent messages left this month")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Find candidates for my latest job" }));
    expect(screen.getByText("2 of your 50 agent messages left this month")).toBeInTheDocument();
  });

  it("shows nothing without a cap", () => {
    render(<ChatPane role="company" sessionId={SESSION_ID} initialMessages={[]} />);
    expect(screen.queryByText(/agent messages left this month/)).not.toBeInTheDocument();
  });
});

describe("MemoriesPanel for a company user", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("describes memories as hiring context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ memories: [] })))),
    );
    render(<MemoriesPanel role="company" />);

    await userEvent.click(screen.getByRole("button", { name: "Memories" }));

    expect(
      await screen.findByText("What the assistant remembers about your hiring"),
    ).toBeInTheDocument();
  });
});
