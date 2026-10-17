import { cn } from "@/utils/utils";

/** Up to two initials from a name, else from an email's local part. */
export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const source = name?.trim() || email?.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "";
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}

/** TM-REQ-008: who did something, as initials (theme tokens, no images). */
export default function MemberAvatar({
  name,
  email,
  className,
}: {
  name: string | null | undefined;
  email?: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      title={name ?? email ?? undefined}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {initialsOf(name, email)}
    </span>
  );
}
