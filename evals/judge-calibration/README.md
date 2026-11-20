# Judge calibration

How often the Arize online-eval judges (agent spec §13) agree with a person. The judge (`mimo-v2.6-flash`) has given labels its own explanation contradicted, so its pass rates can't be read at face value until this is measured.

## Workflow

1. **Draw a sample** for one eval (one Arize annotation queue each):

   ```sh
   npx tsx --env-file=.env scripts/judge-calibration.ts sample --eval reply_groundedness --days 14 --annotator <your Arize login email>
   ```

   - It takes only spans scored by the evaluator's **current version**, so a template change means a new sample.
   - The sample is stratified: up to `--per-stratum` (30) spans the judge failed and 30 it passed. Judges fail only 2–25% of spans, so a plain random sample would hold too few fails to say whether the judge catches them. `report` re-weights by the stratum sizes saved in the manifest.
   - `--role applicant|company` keeps one side.
   - `--seed` redraws the same sample.
   - Eval names: `Main Agent Request Relevance`, `Recruiter Request Relevance`, `reply_groundedness`, `agent_trajectory`, `reply_safety_pii`, `tool_selection_quality`, `tool_arguments_quality`.
2. **Label the queue in Arize** (Annotation queues → `Judge check: …`). Give each span `judge_check_<eval>` = pass or fail, using the criterion in the queue's instructions. Add a `judge_check_note` when it's a close call. Decide **before** looking at the span's Evaluations: seeing the judge's label first biases the result.
3. **Read the result:**

   ```sh
   npx tsx --env-file=.env scripts/judge-calibration.ts report [--manifest <file>] [--disagreements]
   ```

   For each eval it prints:
   - "judge fail → you fail": of what the judge flags, how much is a real failure.
   - "judge pass → you pass".
   - Population estimates: accuracy, the share of real failures the judge catches, the real failure rate against the judge's, and Cohen's kappa.

   `--disagreements` lists each disagreement with the judge's explanation and your note, in the terminal only.

## Reading the numbers

- About 30 labels per stratum give a 95% interval of roughly ±15 points. Treat a judge as usable for alerting when "judge fail → you fail" is at least 80% and kappa is at least 0.6.
- If the judge catches few real failures, the template is too lenient. If it flags many passes, it is too strict. Read the disagreements to see which criterion it misreads.
- After changing a template, draw a new sample. Old labels stay valid for the old version only.

## User feedback

`scripts/import-agent-feedback.ts` copies 👍/👎 onto the chat traces as `user_rating`. Then:

```sh
npx tsx --env-file=.env scripts/judge-calibration.ts feedback
```

This sets the votes against each eval. A judge that passes most 👎 replies is missing what users dislike. Votes are few and biased toward strong reactions, so this is a check alongside the hand labels, not a replacement.

## Files

`samples/*.json` are the manifests: span ids, the judge's verdict, the stratum sizes and the window. They hold no span content, and `report` needs them.
