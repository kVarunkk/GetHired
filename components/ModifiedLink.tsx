"use client";

import React, { AnchorHTMLAttributes, forwardRef, startTransition } from "react";
import Link from "next/link";
import { cn } from "@/utils/utils";
import { useRouter } from "next/navigation";
import { useProgress } from "react-transition-progress";

interface ModifiedLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: React.ReactNode;
  target?: string;
}

/**
 * A `next/link` that shows the progress bar while it navigates. Being a Next
 * link, it prefetches in production, down to the route's `loading.tsx`, so the
 * skeleton can show as soon as it's clicked.
 *
 * https://nextjs.org/docs/15/app/api-reference/components/link
 */
const ModifiedLink = forwardRef<HTMLAnchorElement, ModifiedLinkProps>(
  ({ href, className, children, target, rel, ...props }, ref) => {
    const router = useRouter();
    const startProgress = useProgress();

    return (
      <Link
        {...props}
        href={href}
        ref={ref}
        target={target}
        rel={target === "_blank" ? cn("noopener noreferrer", rel) : rel}
        // Only for navigations inside the app: Next leaves new tabs and other
        // sites to the browser, and skips this if `onClick` prevented it.
        onNavigate={(event) => {
          // Pushed here, so the progress bar covers the whole transition.
          event.preventDefault();
          startTransition(() => {
            startProgress?.();
            router.push(href);
          });
        }}
        className={cn("cursor-pointer", className)}
      >
        {children}
      </Link>
    );
  },
);
ModifiedLink.displayName = "ModifiedLink";

export default ModifiedLink;
