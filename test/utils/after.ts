/** Tasks passed to the mocked `after()` from `next/server` (see test/setup.ts). */
export const afterCallbacks: Array<(() => unknown) | Promise<unknown>> = [];

/** Runs every task scheduled with `after()` and clears the queue. */
export async function flushAfter() {
  const tasks = afterCallbacks.splice(0);
  for (const task of tasks) {
    await (typeof task === "function" ? task() : task);
  }
}
