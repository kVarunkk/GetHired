/**
 * Calibrates the Arize online-eval judges (spec §13) against hand labels.
 *
 *   npx tsx --env-file=.env scripts/judge-calibration.ts sample --eval reply_groundedness [--role applicant]
 *       [--days 14] [--per-stratum 30] [--seed 1] [--annotator you@example.com] [--no-queue]
 *   npx tsx --env-file=.env scripts/judge-calibration.ts report [--manifest <file>] [--disagreements]
 *   npx tsx --env-file=.env scripts/judge-calibration.ts feedback [--days 30]
 *
 * - `sample` reads the spans the eval scored in the window (current evaluator
 *   version only), draws up to `--per-stratum` judge fails and as many
 *   passes, and puts them in a new Arize annotation queue with the
 *   `judge_check_<eval>` (pass / fail) and `judge_check_note` configs. It
 *   saves a manifest (span ids and stratum sizes, no content) to
 *   evals/judge-calibration/samples/, which `report` needs to re-weight.
 * - Label the queue in Arize. `report` then reads the labels back and prints,
 *   per eval, how often the judge agrees, re-weighted to the population.
 *   `--disagreements` also prints each disagreement with the judge's
 *   explanation and your note (to the terminal only).
 * - `feedback` sets the users' 👍/👎 (imported by import-agent-feedback.ts)
 *   against each eval's verdicts on the same turns.
 *
 * Uses ARIZE_API_KEY and ARIZE_SPACE_ID.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactContactDetails } from "../helpers/agent/contact-details";
import { arg, arizeFromEnv, flag, type ArizeSpan } from "./arize-lib";
import { CHAT_ROOT_FILTER, USER_RATING_CONFIG } from "./import-agent-feedback-lib";
import {
  calibrate,
  crossTabFeedback,
  currentVersion,
  drawSample,
  evaluationFilter,
  formatCalibration,
  HUMAN_NOTE_CONFIG,
  humanConfigName,
  humanNote,
  humanVerdict,
  JUDGES,
  judgeVerdict,
  latestEvaluation,
  QUEUE_PREAMBLE,
  VERDICT_VALUES,
  type Manifest,
} from "./judge-calibration-lib";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAD_MS = 60_000;
const SAMPLES_DIR = join(process.cwd(), "evals", "judge-calibration", "samples");

async function collect(iterable: AsyncIterable<ArizeSpan>): Promise<ArizeSpan[]> {
  const out: ArizeSpan[] = [];
  for await (const span of iterable) out.push(span);
  return out;
}

/**
 * Spans with an annotation, or none: Arize refuses a filter on an annotation
 * column that no span has yet ("column … does not exist").
 */
async function collectAnnotated(iterable: AsyncIterable<ArizeSpan>): Promise<ArizeSpan[]> {
  try {
    return await collect(iterable);
  } catch (error) {
    if (error instanceof Error && /column "annotation\.[^"]+" does not exist/.test(error.message)) return [];
    throw error;
  }
}

async function sample() {
  const evaluation = arg("eval");
  if (!evaluation) {
    throw new Error(`--eval is required: one of ${JUDGES.map((j) => `"${j.evaluation}"`).join(", ")}`);
  }
  const judge = JUDGES.find((j) => j.evaluation === evaluation);
  const role = arg("role");
  const days = Math.max(1, Number(arg("days") ?? 14));
  const perStratum = Math.max(1, Number(arg("per-stratum") ?? 30));
  const seed = Number(arg("seed") ?? Date.now() % 1_000_000);
  const filter = arg("filter") ?? evaluationFilter(evaluation, judge);
  if (!filter) throw new Error(`"${evaluation}" can't be filtered by name; pass --filter with the spans it scores.`);

  const end = new Date();
  const start = new Date(end.getTime() - days * DAY_MS);
  const arize = arizeFromEnv();

  console.log(`Reading spans scored by ${evaluation} since ${start.toISOString()}…`);
  const spans = await collect(arize.listSpans({ start, end, filter }));
  const versionId = currentVersion(spans, evaluation);
  const { population, sample: picked } = drawSample(spans, { evaluation, versionId, role, perStratum, seed });
  console.log(
    `Current evaluator version ${versionId ?? "(none)"}: judge passed ${population.pass}, failed ${population.fail}. ` +
      `Sampled ${picked.filter((s) => s.judge === "fail").length} fails and ${picked.filter((s) => s.judge === "pass").length} passes (seed ${seed}).`,
  );
  if (!picked.length) return;

  const humanConfig = humanConfigName(evaluation);
  let queueId: string | null = null;
  if (!flag("no-queue")) {
    const configIds = [
      await arize.ensureCategoricalConfig({ name: humanConfig, values: VERDICT_VALUES }),
      await arize.ensureFreeformConfig(HUMAN_NOTE_CONFIG),
    ];
    const annotator = arg("annotator");
    const date = end.toISOString().slice(0, 10);
    queueId = await arize.createAnnotationQueue({
      name: `Judge check: ${evaluation}${role ? ` (${role})` : ""} ${date} #${seed}`,
      instructions: `${QUEUE_PREAMBLE}\n\n${judge?.criterion ?? `Label as the "${evaluation}" judge's template defines pass and fail.`}`,
      annotationConfigIds: configIds,
      ...(annotator ? { annotatorEmails: [annotator] } : {}),
    });
    // Shuffle the strata together so the queue doesn't show all fails first.
    const order = [...picked].sort((a, b) => a.spanId.localeCompare(b.spanId));
    await arize.addSpansToQueue({ queueId, spans: order.map((s) => ({ spanId: s.spanId, startTime: s.startTime })) });
    console.log(`Created annotation queue ${queueId} with ${picked.length} spans.`);
  }

  const manifest: Manifest = {
    evaluation,
    evaluatorVersionId: versionId ?? null,
    role: role ?? null,
    window: { start: start.toISOString(), end: end.toISOString() },
    createdAt: end.toISOString(),
    population,
    humanConfig,
    queueId,
    spans: picked,
  };
  mkdirSync(SAMPLES_DIR, { recursive: true });
  const file = join(SAMPLES_DIR, `${humanConfig}${role ? `-${role}` : ""}-${end.toISOString().slice(0, 10)}-${seed}.json`);
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Saved the manifest to ${file}`);
}

function manifests(): { file: string; manifest: Manifest }[] {
  const only = arg("manifest");
  const files = only
    ? [only]
    : readdirSync(SAMPLES_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => join(SAMPLES_DIR, f));
  return files.map((file) => ({ file, manifest: JSON.parse(readFileSync(file, "utf8")) as Manifest }));
}

const clip = (text: string | undefined | null, max = 300) => {
  const clean = redactContactDetails((text ?? "").replace(/\s+/g, " ").trim());
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

async function report() {
  const arize = arizeFromEnv();
  const showDisagreements = flag("disagreements");
  for (const { file, manifest } of manifests()) {
    const config = manifest.humanConfig;
    const spans = await collectAnnotated(
      arize.listSpans({
        start: new Date(Date.parse(manifest.window.start) - PAD_MS),
        end: new Date(Date.parse(manifest.window.end) + PAD_MS),
        filter: `annotation.${config}.label = 'pass' or annotation.${config}.label = 'fail'`,
      }),
    );
    const byId = new Map(spans.map((span) => [span.context.span_id, span]));
    const items = manifest.spans.flatMap((s) => {
      const span = byId.get(s.spanId);
      const human = span ? humanVerdict(span, config) : null;
      return human ? [{ ...s, human, span: span! }] : [];
    });

    console.log(`\n${file}`);
    console.log(`  labelled ${items.length} of ${manifest.spans.length}`);
    console.log(formatCalibration(manifest, calibrate(items, manifest.population)));

    if (showDisagreements) {
      for (const item of items.filter((i) => i.judge !== i.human)) {
        const explanation = latestEvaluation(item.span, manifest.evaluation, manifest.evaluatorVersionId ?? undefined)
          ?.explanation;
        console.log(`\n  ${item.spanId} (trace ${item.traceId}): judge ${item.judge}, you ${item.human}`);
        console.log(`    judge: ${clip(explanation)}`);
        const note = humanNote(item.span);
        if (note) console.log(`    you: ${clip(note)}`);
      }
    }
  }
}

async function feedback() {
  const arize = arizeFromEnv();
  const days = Math.min(31, Math.max(1, Number(arg("days") ?? 30)));
  const end = new Date();
  const start = new Date(end.getTime() - days * DAY_MS);
  const rating = USER_RATING_CONFIG.name;
  const spans = await collectAnnotated(
    arize.listSpans({
      start,
      end,
      filter: `(${CHAT_ROOT_FILTER}) and (annotation.${rating}.label = 'up' or annotation.${rating}.label = 'down')`,
    }),
  );
  console.log(`${spans.length} rated chat turns in the last ${days} days`);
  const names = new Set(spans.flatMap((span) => (span.evaluations ?? []).filter((e) => judgeVerdict(e)).map((e) => e.name)));
  for (const name of [...names].sort()) {
    const t = crossTabFeedback(spans, name, rating);
    const caught = t.down.fail + t.down.pass ? t.down.fail / (t.down.fail + t.down.pass) : null;
    console.log(
      `${name}: 👎 judged fail ${t.down.fail}, pass ${t.down.pass}` +
        (caught == null ? "" : ` (flags ${(caught * 100).toFixed(0)}% of 👎)`) +
        `; 👍 judged fail ${t.up.fail}, pass ${t.up.pass}`,
    );
  }
}

const commands: Record<string, () => Promise<void>> = { sample, report, feedback };
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error("Usage: judge-calibration.ts sample|report|feedback [options] (see the file's header)");
  process.exit(1);
}
command().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
