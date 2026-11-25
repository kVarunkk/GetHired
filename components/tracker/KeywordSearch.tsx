"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/utils/utils";

/**
 * My Jobs' only filter (AT-REQ-020): a keyword over title and company, kept
 * in the URL as `q`, the same on both tabs and in both views.
 */
export default function KeywordSearch({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("q") ?? "";
  const [value, setValue] = useState(current);
  const debounced = useDebounce(value, 300);

  // Back/forward and Clear Filters change the URL under us.
  useEffect(() => setValue(current), [current]);

  useEffect(() => {
    if (debounced.trim() === current.trim()) return;
    const params = new URLSearchParams(searchParams.toString());
    if (debounced.trim()) params.set("q", debounced.trim());
    else params.delete("q");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // Only a typed change writes the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search by title or company"
        aria-label="Search by title or company"
        className="pl-8 text-sm"
      />
    </div>
  );
}
