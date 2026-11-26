import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModifiedLink from "./ModifiedLink";

const push = vi.fn();
const startProgress = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("react-transition-progress", () => ({ useProgress: () => startProgress }));
// Stands in for next/link's click order: `onClick`, then `onNavigate` unless
// the click was prevented or opens elsewhere.
vi.mock("next/link", async () => {
  const { forwardRef } = await import("react");
  type Props = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    onNavigate?: (event: { preventDefault: () => void }) => void;
  };
  const Link = forwardRef<HTMLAnchorElement, Props>(({ onNavigate, onClick, children, ...props }, ref) => (
    <a
      {...props}
      ref={ref}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        const elsewhere = e.metaKey || e.ctrlKey || (!!props.target && props.target !== "_self");
        e.preventDefault();
        if (!elsewhere) onNavigate?.({ preventDefault: () => {} });
      }}
    >
      {children}
    </a>
  ));
  Link.displayName = "Link";
  return { default: Link };
});

beforeEach(() => vi.clearAllMocks());

describe("ModifiedLink", () => {
  it("starts the progress bar and pushes the route", () => {
    render(<ModifiedLink href="/resume">Resumes</ModifiedLink>);
    fireEvent.click(screen.getByRole("link", { name: "Resumes" }));
    expect(startProgress).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledExactlyOnceWith("/resume");
  });

  it("leaves a new-tab click to the browser", () => {
    render(<ModifiedLink href="/resume">Resumes</ModifiedLink>);
    fireEvent.click(screen.getByRole("link"), { ctrlKey: true });
    expect(push).not.toHaveBeenCalled();
    expect(startProgress).not.toHaveBeenCalled();
  });

  it("doesn't navigate when onClick prevents it", () => {
    render(
      <ModifiedLink href="/resume" onClick={(e) => e.preventDefault()}>
        Resumes
      </ModifiedLink>,
    );
    fireEvent.click(screen.getByRole("link"));
    expect(push).not.toHaveBeenCalled();
  });

  it("opens a _blank link safely", () => {
    render(
      <ModifiedLink href="/resume" target="_blank">
        Resumes
      </ModifiedLink>,
    );
    expect(screen.getByRole("link").getAttribute("rel")).toBe("noopener noreferrer");
  });
});
