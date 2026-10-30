import { beforeEach, describe, expect, it, vi } from "vitest";
import { embedMany } from "ai";
import { embedJobs, jobEmbeddingText } from "./job-embedding";

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ embedMany: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ google: { embedding: (id: string) => ({ id }) } }));

const JOB = {
  job_name: "Frontend Engineer",
  description: "Build the product UI.",
  locations: ["bengaluru", "remote"],
  job_type: "Fulltime",
  salary_range: "₹15L - ₹25L",
};

beforeEach(() => vi.clearAllMocks());

describe("jobEmbeddingText", () => {
  it("lists the role, locations, description, type and pay", () => {
    expect(jobEmbeddingText(JOB).split("\n").map((line) => line.trim())).toEqual([
      "ROLE: Frontend Engineer",
      "LOCATION: bengaluru, remote",
      "DETAILED DESCRIPTION: Build the product UI.",
      "TYPE: Fulltime",
      "COMPENSATION: ₹15L - ₹25L",
    ]);
  });

  it("fills in missing fields", () => {
    const text = jobEmbeddingText({
      job_name: null,
      description: null,
      locations: null,
      job_type: null,
      salary_range: null,
    });
    expect(text).toContain("ROLE: N/A");
    expect(text).toContain("LOCATION: \n");
    expect(text).toContain("COMPENSATION: N/A");
  });
});

describe("embedJobs", () => {
  it("embeds every job with 768-dimension Gemini vectors and returns pgvector literals in order", async () => {
    vi.mocked(embedMany).mockResolvedValue({ embeddings: [[0.1, 0.2], [0.3]] } as never);

    expect(await embedJobs([JOB, { ...JOB, job_name: "Designer" }])).toEqual(["[0.1,0.2]", "[0.3]"]);
    expect(embedMany).toHaveBeenCalledWith({
      model: { id: "gemini-embedding-001" },
      values: [jobEmbeddingText(JOB), jobEmbeddingText({ ...JOB, job_name: "Designer" })],
      providerOptions: { google: { outputDimensionality: 768 } },
    });
  });
});
