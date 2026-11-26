/**
 * A promise React's `use` reads straight away, so a component test can render
 * server data that has already arrived without suspending.
 */
export function settled<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled" as const, value });
}
