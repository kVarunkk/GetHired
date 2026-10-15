/**
 * Offline screening eval (MT-TEST-008, MT-TASK-025). Not part of CI: it calls
 * the real model.
 *
 *   npx tsx --env-file=.env scripts/eval-screening.ts [--swaps 2] [--concurrency 5] [--only fe-1,be-2] [--temperature 0] [--placebo] [--out results.json]
 *
 * For each of the 30 labelled pairs in scripts/eval-data/screening-pairs.json
 * it screens the application as a baseline identity, again as the same
 * identity (to measure the model's own noise), and once per swapped identity
 * where only the candidate's name and home location change. It reports the
 * Spearman correlation of the baseline scores against the labels, the
 * largest score change from a swap, and the cost per screening. Exits 1 if
 * any swap moves a score by more than SWAP_TOLERANCE.
 *
 * `--placebo` replaces the identity swaps with two edits that say nothing
 * about the candidate (placeboVariant), as a control: it shows how much any
 * small wording change moves a score.
 *
 * `--temperature` overrides the model's sampling temperature for this run
 * only (production uses the default), to separate sampling noise from an
 * identity effect.
 *
 * Uses GOOGLE_GENERATIVE_AI_API_KEY. Prices per million tokens can be set
 * with EVAL_PRICE_INPUT and EVAL_PRICE_OUTPUT (USD).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { google } from "@ai-sdk/google";
import { wrapLanguageModel } from "ai";
import { MT_MODEL } from "../helpers/matching/config";
import { screenApplication } from "../helpers/matching/screen-application";
import {
  SWAP_TOLERANCE,
  applyIdentity,
  identitiesFor,
  placeboVariant,
  summarise,
  type EvalJob,
  type EvalPair,
  type PairResult,
} from "./eval-screening-lib";

const PRICE_INPUT = Number(process.env.EVAL_PRICE_INPUT ?? 0.25);
const PRICE_OUTPUT = Number(process.env.EVAL_PRICE_OUTPUT ?? 1.5);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const usage = { calls: 0, input: 0, output: 0 };
const temperature = arg("temperature") === undefined ? undefined : Number(arg("temperature"));

const model = wrapLanguageModel({
  model: google(MT_MODEL),
  middleware: {
    specificationVersion: "v4",
    transformParams: async ({ params }) =>
      temperature === undefined ? params : { ...params, temperature },
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      usage.calls += 1;
      usage.input += result.usage.inputTokens.total ?? 0;
      usage.output += result.usage.outputTokens.total ?? 0;
      return result;
    },
  },
});

function loadPairs(): EvalPair[] {
  const data = JSON.parse(
    readFileSync(join(__dirname, "eval-data", "screening-pairs.json"), "utf8"),
  ) as {
    jobs: Record<string, EvalJob>;
    pairs: (Omit<EvalPair, "job"> & { jobId: string })[];
  };
  return data.pairs.map(({ jobId, ...pair }) => {
    const job = data.jobs[jobId];
    if (!job) throw new Error(`Pair ${pair.id}: unknown job ${jobId}`);
    return { ...pair, job };
  });
}

async function score(pair: EvalPair, identity: ReturnType<typeof identitiesFor>[number]) {
  const result = await screenApplication(applyIdentity(pair, identity), { model, timeoutMs: 60_000 });
  if (!result.ok) throw new Error(result.errorCode);
  return result.result.fit_score;
}

async function evaluatePair(
  pair: EvalPair,
  index: number,
  swaps: number,
  placebo: boolean,
): Promise<PairResult> {
  const [baselineIdentity, ...swapIdentities] = identitiesFor(index, swaps);
  const variants = placebo
    ? ([1, 2] as const).map((v) => ({ label: `placebo ${v}`, run: () => score(placeboVariant(pair, v), baselineIdentity) }))
    : swapIdentities.map((identity) => ({ label: identity.name, run: () => score(pair, identity) }));
  try {
    const [baseline, repeat, ...swapScores] = await Promise.all([
      score(pair, baselineIdentity),
      score(pair, baselineIdentity),
      ...variants.map((v) => v.run()),
    ]);
    const result = {
      id: pair.id,
      label: pair.label,
      baseline,
      repeat,
      swaps: variants.map((v, i) => ({ identity: v.label, score: swapScores[i] })),
    };
    console.log(
      `${pair.id.padEnd(6)} ${pair.label.padEnd(10)} base ${baseline} repeat ${repeat} swaps ${swapScores.join(", ")}`,
    );
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(`${pair.id.padEnd(6)} ${pair.label.padEnd(10)} error ${error}`);
    return { id: pair.id, label: pair.label, error };
  }
}

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set (run with --env-file=.env).");
  }
  const swaps = Number(arg("swaps") ?? 2);
  const concurrency = Number(arg("concurrency") ?? 5);
  const only = arg("only")?.split(",");
  const placebo = process.argv.includes("--placebo");

  const pairs = loadPairs().filter((pair) => !only || only.includes(pair.id));
  const at = temperature === undefined ? "" : ` at temperature ${temperature}`;
  console.log(`Screening ${pairs.length} pairs with ${MT_MODEL}${at}: baseline, repeat and ${placebo ? "2 placebo edits" : `${swaps} swaps`} each.\n`);

  const results: PairResult[] = new Array(pairs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < pairs.length) {
        const i = next++;
        results[i] = await evaluatePair(pairs[i], i, swaps, placebo);
      }
    }),
  );

  const summary = summarise(results);
  const costPerCall = usage.calls
    ? (usage.input * PRICE_INPUT + usage.output * PRICE_OUTPUT) / 1_000_000 / usage.calls
    : 0;

  console.log(`
Screened:              ${summary.screened} of ${pairs.length} (errors: ${summary.errors.length})
Spearman vs labels:    ${summary.spearman.toFixed(3)}
Max swap delta:        ${summary.maxSwapDelta} (tolerance ${SWAP_TOLERANCE}); mean ${summary.meanSwapDelta.toFixed(2)}
Same-identity noise:   max ${summary.maxNoiseDelta}; mean ${summary.meanNoiseDelta.toFixed(2)}
Tokens per screening:  ${Math.round(usage.input / Math.max(1, usage.calls))} in, ${Math.round(usage.output / Math.max(1, usage.calls))} out (${usage.calls} calls)
Cost per screening:    $${costPerCall.toFixed(5)} (at $${PRICE_INPUT}/M in, $${PRICE_OUTPUT}/M out)
Result:                ${summary.passed ? "PASS" : "FAIL"}`);

  if (summary.failures.length) {
    console.log("\nSwaps over the tolerance:");
    for (const f of summary.failures) {
      console.log(`  ${f.id}: ${f.baseline} → ${f.score} as ${f.identity} (Δ${f.delta})`);
    }
  }
  if (summary.errors.length) console.log("\nErrors:", summary.errors);

  const out = arg("out");
  if (out) {
    writeFileSync(
      out,
      JSON.stringify({ model: MT_MODEL, temperature, placebo, summary, usage, costPerCall, results }, null, 2),
    );
    console.log(`\nWrote ${out}`);
  }

  process.exitCode = summary.passed ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
