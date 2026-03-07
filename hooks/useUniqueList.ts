import { useMemo } from "react";

export function useUniqueList<T, K extends keyof T>(data?: T[], key?: K) {
  return useMemo(
    () =>
      (key !== undefined && data)
        ? data
            .map((item) => item[key] as unknown as string)
            .filter(Boolean)
            .map((v) => ({ value: v, label: v }))
        : [],
    [data, key],
  );
}
