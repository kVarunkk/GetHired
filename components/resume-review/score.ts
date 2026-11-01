/** Match score colour: green when strong, amber when middling, red when weak. */
export function scoreColorClass(score: string | number) {
  const value = parseFloat(String(score));
  if (Number.isNaN(value)) return "text-foreground";
  if (value >= 75) return "text-success";
  if (value >= 50) return "text-warning";
  return "text-destructive";
}
