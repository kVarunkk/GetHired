import { Badge } from "@/components/ui/badge";
import { matchBandFor } from "@/helpers/matching/config";
import { cn } from "@/utils/utils";

/**
 * A match or fit score as "82 · Strong" (MT-GUD-001). Always the neutral
 * outline badge: people aren't colour-coded good or bad.
 */
export default function MatchScoreBadge({
  score,
  className,
}: {
  score: number | null | undefined;
  className?: string;
}) {
  if (score === null || score === undefined) return null;

  const { word } = matchBandFor(score);

  return (
    <Badge
      variant="outline"
      className={cn("tabular-nums", className)}
      aria-label={`Match score ${score} out of 100, ${word.toLowerCase()}`}
    >
      {score} · {word}
    </Badge>
  );
}
