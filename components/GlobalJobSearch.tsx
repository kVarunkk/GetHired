"use client";

import { useState, useCallback, useRef, startTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import toast from "react-hot-toast";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useProgress } from "react-transition-progress";
import { Textarea } from "./ui/textarea";
import { TAICredits } from "@/utils/types";
import InfoTooltip from "./InfoTooltip";
import useSWR, { mutate } from "swr";
import { fetcher, premadePrompts, PROFILE_API_KEY } from "@/utils/utils";
import Link from "next/link";
import ScrollFade from "./ScrollFade";

interface ParsedFilters {
  [key: string]: string | string[] | undefined;
}

export default function GlobalJobSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchInputRef = useRef<HTMLTextAreaElement>(null);
  const startProgress = useProgress();
  const { data } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });

  const buildUrlParams = useCallback(
    (filters: ParsedFilters): URLSearchParams => {
      const params = new URLSearchParams();

      for (const key in filters) {
        const value = filters[key];
        if (value === undefined || value === null) continue;

        if (Array.isArray(value) && value.length > 0) {
          params.set(key, value.join("|"));
        } else if (typeof value === "string" && value) {
          params.set(key, value);
        }
      }

      return params;
    },
    [],
  );

  const handleSubmit = async (formData: FormData) => {
    setError(null);

    const query = formData.get("searchQuery")?.toString()?.trim();

    if (!query) return;

    setIsLoading(true);

    try {
      const response = await fetch("/api/ai-search/global/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userQuery: query }),
      });

      if (!response.ok) {
        const errorResult = await response.json();
        throw new Error(
          errorResult.error ||
            `AI parsing failed with status ${response.status}`,
        );
      }

      const { filters } = await response.json();

      const params = buildUrlParams(filters);
      mutate(PROFILE_API_KEY);

      startTransition(() => {
        startProgress();
        router.push(`/jobs?${params.toString()}`);
      });

      setIsOpen(false);
    } catch (error) {
      toast.error(
        `Search failed: ${(error as Error).message}. Please try again.`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handlePromptClick = (prompt: string) => {
    if (searchInputRef.current) {
      searchInputRef.current.value = prompt; // Set input value
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button
          title="AI Search"
          variant="link"
          // size="link"
          aria-label="Open global job search"
          className="min-w-0 flex-1 justify-start rounded-full text-xs bg-secondary text-muted-foreground !no-underline hover:text-primary transition-colors sm:flex-none"
        >
          <Search className="h-5 w-5" />
          <span className="truncate">Search Jobs with AI...</span>
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="sm:max-w-xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="text-start">
            What kind of job are you looking for?
          </ResponsiveDialogTitle>
          {/* Inline text, not flex, so a narrow screen wraps it like a sentence. */}
          <ResponsiveDialogDescription className="text-start">
            {/* NEED TO SHOW USER THE AI CREDITS LEFT */}
            {data && data.profile
              ? `${data.profile.ai_credits} AI Credits available. `
              : ""}
            <Link
              href={"/dashboard/buy-credits"}
              className="whitespace-nowrap font-medium underline underline-offset-4"
            >
              Recharge Credits
            </Link>
            <span className="-my-2 inline-block align-middle">
              <InfoTooltip
                content={
                  "This feature uses " +
                  TAICredits.AI_SEARCH_ASK_AI_RESUME +
                  " AI credits per search."
                }
              />
            </span>
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            handleSubmit(formData);
          }}
          className="flex min-h-0 flex-col gap-4"
        >
          <ResponsiveDialogBody className="flex flex-col space-y-4">
            <Textarea
              // type="text"
              required
              placeholder="e.g., Senior Java jobs in London with visa sponsorship"
              name="searchQuery"
              disabled={isLoading}
              className="text-sm"
              ref={searchInputRef}
            />

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1" className="border-0">
                <AccordionTrigger className="text-sm">
                  Need inspiration? Try these prompts:
                </AccordionTrigger>
                <AccordionContent>
                  {/* A fixed-height list with a fade instead of a scrollbar. On
                    short screens it shrinks (20dvh) so the open drawer still
                    fits without scrolling. */}
                  <ScrollFade
                    className="h-[min(150px,20dvh)]"
                    contentClassName="flex flex-col space-y-2"
                  >
                    {premadePrompts.map((prompt, index) => (
                      <Button
                        key={index}
                        variant="ghost"
                        className="justify-start h-auto px-2 py-1 text-sm text-muted-foreground  whitespace-normal text-left"
                        type="button"
                        onClick={() => handlePromptClick(prompt)}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </ScrollFade>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </ResponsiveDialogBody>

          {/* In the fixed footer, so opening the prompts never pushes it out
              of view. */}
          <ResponsiveDialogFooter>
            <Button
              type="submit"
              variant="brand"
              disabled={isLoading}
              className="w-full"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Search Jobs
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
