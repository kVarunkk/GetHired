import { Suspense, use, type ReactNode } from "react";

/**
 * A part of a server page that streams in when its data is ready, so the rest
 * of the page doesn't wait for it. Start the promise before the page's own
 * awaits. It must not reject: catch it where it's made.
 */
export default function Streamed<T>({
  promise,
  fallback = null,
  children,
}: {
  promise: Promise<T>;
  fallback?: ReactNode;
  children: (value: T) => ReactNode;
}) {
  return (
    <Suspense fallback={fallback}>
      <Resolved promise={promise}>{children}</Resolved>
    </Suspense>
  );
}

// `use` rather than an async component, so component tests can render it too.
function Resolved<T>({ promise, children }: { promise: Promise<T>; children: (value: T) => ReactNode }) {
  return children(use(promise));
}
