"use client";

import React, {
  AnchorHTMLAttributes,
  forwardRef,
  startTransition,
} from "react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useProgress } from "react-transition-progress";

interface ModifiedLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: React.ReactNode;
  target?: string;
}

const ModifiedLink = forwardRef<HTMLAnchorElement, ModifiedLinkProps>(
  ({ href, className, children, target, ...props }, ref) => {
    const router = useRouter();
    const startProgress = useProgress();

    const handleNavigation = (e: React.MouseEvent<HTMLAnchorElement>) => {
      // 1. Execute any parent-provided onClick (for Tooltips or tracking)
      if (props.onClick) props.onClick(e);

      // 2. Detect if the user wants a new tab (target="_blank" or modifier clicks)
      const isNewTabRequested =
        target === "_blank" ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        (e.nativeEvent && e.button === 1); // Middle click

      if (isNewTabRequested) return;

      // 2. Avoid double-handling if default is already prevented
      if (e.defaultPrevented) return;

      // 3. Prevent standard browser navigation
      e.preventDefault();

      /**
       * 4. Trigger the Progress Bar
       * We wrap the router push in the progress trigger so the
       * library knows exactly when the transition starts and ends.
       */
      startTransition(() => {
        if (startProgress) {
          // Trigger the progress bar provided by react-transition-progress
          startProgress();
          router.push(href);
        } else {
          router.push(href);
        }
      });
    };

    return (
      <a
        {...props}
        href={href}
        ref={ref}
        target={target}
        rel={
          target === "_blank" ? cn("noopener noreferrer", props.rel) : props.rel
        }
        onClick={handleNavigation}
        className={cn("cursor-pointer", className)}
      >
        {children}
      </a>
    );
  }
);
ModifiedLink.displayName = "ModifiedLink";

export default ModifiedLink;
