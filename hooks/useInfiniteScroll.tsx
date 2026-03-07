import {
  useCallback,
  useEffect,
  useRef,
  useState,
  MutableRefObject,
} from "react";

export interface UseInfiniteScrollOptions<T> {
  /** initial data already rendered by the server */
  initialItems: T[];
  /** total number of items available server‑side */
  totalCount: number;
  /**
   * function that fetches the given page.
   * should return an array of items or throw on error.
   */
  fetchPage: (page: number) => Promise<T[]>;
  /**
   * any values that, when changed, should reset the list.
   * e.g. the current filter/search parameters.
   */
  resetDeps?: any[];
}

export function useInfiniteScroll<T>({
  initialItems,
  totalCount,
  fetchPage,
  resetDeps = [],
}: UseInfiniteScrollOptions<T>) {
  const [items, setItems] = useState<T[]>(initialItems);
  const [isLoading, setIsLoading] = useState(false);

  const pageRef = useRef(1);
  const loaderRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (isLoading) return;
    if (items.length >= totalCount) return;

    const next = pageRef.current + 1;
    setIsLoading(true);
    try {
      const newItems = await fetchPage(next);
      if (newItems && newItems.length) {
        pageRef.current = next;
        setItems((prev) => [...prev, ...newItems]);
      }
    } catch (err) {
      // you can expose an onError callback if you like
      console.error("infinite scroll load failed", err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchPage, isLoading, items.length, totalCount]);

  // wire up intersection observer once
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { threshold: 0.1 },
    );
    const el = loaderRef.current;
    if (el) observer.observe(el);

    return () => {
      if (el) observer.unobserve(el);
      observer.disconnect();
    };
  }, [loadMore]);

  // reset state when dependencies change (search params, etc.)
  useEffect(() => {
    setItems(initialItems);
    pageRef.current = 1;
  }, [initialItems, ...resetDeps]);

  return {
    items,
    isLoading,
    loaderRef: loaderRef as MutableRefObject<HTMLDivElement>,
    loadMore,
    page: pageRef.current,
    reset: () => {
      setItems(initialItems);
      pageRef.current = 1;
    },
  };
}
