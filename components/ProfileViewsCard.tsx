import { Eye } from "lucide-react";
import { PROFILE_VIEW_WINDOW_DAYS } from "@/helpers/outreach/config";
import { Card, CardContent } from "./ui/card";

/**
 * "N companies viewed your profile" on /dashboard (OR-REQ-021). A count of
 * distinct companies only, never their names (OR-DEC-002). Hidden at 0.
 */
export default function ProfileViewsCard({ count }: { count: number }) {
  if (!count || count < 1) return null;

  return (
    <Card className="flex flex-col p-4">
      <CardContent className="flex h-full flex-1 flex-col gap-2 p-0 text-start">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-semibold tracking-tight">{count}</span>
          <Eye className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          {count === 1 ? "company" : "companies"} viewed your profile in the last{" "}
          {PROFILE_VIEW_WINDOW_DAYS} days
        </p>
      </CardContent>
    </Card>
  );
}
