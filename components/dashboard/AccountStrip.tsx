import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { Coins, Receipt } from "lucide-react";
import McpConnectLink from "@/components/dashboard/McpConnectLink";
import RechargeCredits from "@/components/RechargeCredits";

const linkClass = "flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground";

/**
 * The dashboard's account row: credits and how to get more, purchase
 * history, and connecting an AI assistant over MCP. Kept small and under
 * the matched jobs, since none of it is about the job search itself.
 */
export default function AccountStrip({
  user,
  credits,
  invitationsCount,
  hasPurchases,
}: {
  user: User;
  credits: number;
  invitationsCount: number;
  hasPurchases: boolean;
}) {
  return (
    <section
      aria-label="Account"
      className="flex flex-col gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-1.5">
          <Coins className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="font-semibold tabular-nums">{credits}</span>
          <span className="text-muted-foreground">AI credits</span>
        </span>
        {hasPurchases && (
          <Link className={linkClass} href="/dashboard/buy-credits/payments">
            <Receipt className="h-4 w-4" aria-hidden />
            Purchase history
          </Link>
        )}
        <McpConnectLink />
      </div>
      <RechargeCredits user={user} invitationsCount={invitationsCount} />
    </section>
  );
}
