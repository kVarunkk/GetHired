/** MP-REQ-007: applications and outcomes by the channel they came from. Pure, client-safe. */

export type StatApplication = {
  source: string;
  source_detail: string | null;
  /** The kind of the application's current pipeline stage. */
  stage_kind: string | null;
};

export type ChannelStats = {
  /** A channel key (`jooble`…), `gethired` (applied here) or `other`. */
  channel: string;
  applies: number;
  /** Past the first stage and not rejected or on hold. */
  progressed: number;
  hired: number;
  rejected: number;
};

/** Where an application came from. Only `job_board` applications carry a board in `source_detail`. */
export function channelOf(app: Pick<StatApplication, "source" | "source_detail">): string {
  if (app.source !== "job_board") return "gethired";
  return app.source_detail?.trim() || "other";
}

export function summarizeChannelStats(apps: StatApplication[]): ChannelStats[] {
  const byChannel = new Map<string, ChannelStats>();
  for (const app of apps) {
    const channel = channelOf(app);
    const stats = byChannel.get(channel) ?? { channel, applies: 0, progressed: 0, hired: 0, rejected: 0 };
    stats.applies += 1;
    if (app.stage_kind === "hired") stats.hired += 1;
    else if (app.stage_kind === "rejected") stats.rejected += 1;
    else if (app.stage_kind && !["applied", "on_hold"].includes(app.stage_kind)) stats.progressed += 1;
    byChannel.set(channel, stats);
  }
  return [...byChannel.values()].sort((a, b) => b.applies - a.applies || a.channel.localeCompare(b.channel));
}
