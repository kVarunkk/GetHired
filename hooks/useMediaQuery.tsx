"use client";

import * as React from "react";

// Reads the query during render, so a component mounted after hydration gets
// the right value on its first render. The server (and hydration) sees false.
export function useMediaQuery(query: string) {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const result = matchMedia(query);
      result.addEventListener("change", onChange);
      return () => result.removeEventListener("change", onChange);
    },
    [query],
  );

  return React.useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => false,
  );
}
