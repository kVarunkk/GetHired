import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  filterMentionable,
  mentionToken,
  mentionsToText,
  parseMentions,
  type MentionableMember,
} from "./mentions";

const PRIYA = { userId: "a1000000-0000-4000-8000-000000000001", name: "Priya" };
const PRIYA_SHAH = { userId: "a1000000-0000-4000-8000-000000000002", name: "Priya Shah" };
const SAM = { userId: "a1000000-0000-4000-8000-000000000003", name: "sam" };
const AUTHOR = { userId: "a1000000-0000-4000-8000-000000000004", name: "Asha Rao" };
const TEAM: MentionableMember[] = [PRIYA, PRIYA_SHAH, SAM, AUTHOR];

describe("parseMentions (TMT-070)", () => {
  it("matches @name case-insensitively and returns unique user ids", () => {
    expect(parseMentions("@SAM can you look? cc @sam", TEAM)).toEqual([SAM.userId]);
  });

  it("prefers the longest matching name", () => {
    expect(parseMentions("@Priya Shah please review", TEAM)).toEqual([PRIYA_SHAH.userId]);
    expect(parseMentions("@Priya please review", TEAM)).toEqual([PRIYA.userId]);
  });

  it("ignores emails, unknown names and names inside a longer word", () => {
    expect(parseMentions("mail sam@acme.com or a@b.com", TEAM)).toEqual([]);
    expect(parseMentions("@nobody here", TEAM)).toEqual([]);
    expect(parseMentions("@samantha said hi", TEAM)).toEqual([]);
  });

  it("matches at the start of a line and after punctuation-free spacing", () => {
    expect(parseMentions("first line\n@sam, thoughts?", TEAM)).toEqual([SAM.userId]);
  });

  it("excludes the author", () => {
    expect(parseMentions("@Asha Rao and @sam", TEAM, AUTHOR.userId)).toEqual([SAM.userId]);
  });

  it("reads tokens by id, so a renamed member is still found", () => {
    const body = `${mentionToken({ userId: PRIYA_SHAH.userId, name: "Old Name" })} please check`;
    expect(parseMentions(body, TEAM)).toEqual([PRIYA_SHAH.userId]);
  });

  it("ignores a token for someone no longer on the team", () => {
    const body = mentionToken({ userId: "a1000000-0000-4000-8000-0000000000ff", name: "Gone" });
    expect(parseMentions(body, TEAM)).toEqual([]);
  });

  it("doesn't count a token's name again as a plain mention", () => {
    const body = `${mentionToken({ userId: PRIYA_SHAH.userId, name: "sam" })}`;
    expect(parseMentions(body, TEAM)).toEqual([PRIYA_SHAH.userId]);
  });
});

describe("tokens", () => {
  it("strips characters that would break the token", () => {
    expect(mentionToken({ userId: SAM.userId, name: "Sam [ops] (lead)" })).toBe(
      `@[Sam ops lead](${SAM.userId})`,
    );
  });

  it("renders tokens as @name", () => {
    expect(mentionsToText(`hi ${mentionToken(PRIYA_SHAH)}!`)).toBe("hi @Priya Shah!");
  });
});

describe("composer helpers (TMT-072)", () => {
  it("finds the @query before the caret", () => {
    expect(activeMentionQuery("hello @pri", 10)).toEqual({ query: "pri", start: 6 });
    expect(activeMentionQuery("@", 1)).toEqual({ query: "", start: 0 });
    expect(activeMentionQuery("mail a@b", 8)).toBeNull();
    expect(activeMentionQuery("@pri done", 9)).toBeNull();
  });

  it("filters by a word prefix", () => {
    expect(filterMentionable(TEAM, "sh").map((m) => m.name)).toEqual(["Priya Shah"]);
    expect(filterMentionable(TEAM, "")).toHaveLength(4);
  });
});
