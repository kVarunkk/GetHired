import {
  useCallback,
  useEffect,
  useRef,
  useState,
  MutableRefObject,
} from "react";

interface FetchPageResult<T> {
  data: T[];
  nextCursor: string | null;
}
export interface UseInfiniteScrollOptions<T> {
  /** initial data already rendered by the server */
  initialItems: T[];
  /** total number of items available server‑side */
  // totalCount: number;
  initialCursor: string | null;
  /**
   * function that fetches the given page.
   * should return an array of items or throw on error.
   */
  // fetchPage: (page: number) => Promise<T[]>;
  fetchPage: (cursor: string | null) => Promise<FetchPageResult<T>>;
  /**
   * any values that, when changed, should reset the list.
   * e.g. the current filter/search parameters.
   */
  resetDeps?: any[];
}

export function useInfiniteScroll<T>({
  initialItems,
  initialCursor,
  fetchPage,
  resetDeps = [],
}: UseInfiniteScrollOptions<T>) {
  const [items, setItems] = useState<T[]>(initialItems);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(!!initialCursor);

  // We use a ref for the cursor to ensure loadMore always uses the latest pointer
  // without triggering extra re-renders.
  const cursorRef = useRef<string | null>(initialCursor);
  const loaderRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    // Guards: don't fetch if already loading or if there's no more data
    if (isLoading || !hasMore || !cursorRef.current) return;

    setIsLoading(true);
    try {
      const result = await fetchPage(cursorRef.current);

      if (result.data && result.data.length > 0) {
        setItems((prev) => [...prev, ...result.data]);
      }

      // Update the cursor for the next batch
      cursorRef.current = result.nextCursor;

      // If the API returns a null cursor, we've reached the end of the list
      setHasMore(!!result.nextCursor);
    } catch (err) {
      console.error("[INFINITE_SCROLL_ERROR]:", err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchPage, isLoading, hasMore]);

  // 1. Intersection Observer Logic
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "100px" }, // Added rootMargin to start loading earlier
    );

    const el = loaderRef.current;
    if (el) observer.observe(el);

    return () => {
      if (el) observer.unobserve(el);
      observer.disconnect();
    };
  }, [loadMore]);

  // 2. Reset Logic (Syncing with search filters or tab changes)
  useEffect(() => {
    setItems(initialItems);
    cursorRef.current = initialCursor;
    setHasMore(!!initialCursor);
  }, [initialItems, initialCursor, ...resetDeps]);

  return {
    items,
    isLoading,
    hasMore,
    loaderRef: loaderRef as MutableRefObject<HTMLDivElement>,
    loadMore,
    reset: () => {
      setItems(initialItems);
      cursorRef.current = initialCursor;
      setHasMore(!!initialCursor);
    },
  };
}
