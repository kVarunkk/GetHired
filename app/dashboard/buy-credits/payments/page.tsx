import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import BackButton from "@/components/BackButton";
import { IPayment } from "@/lib/types";
import PaymentsTable from "@/components/PaymentsTable";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default async function PaymentsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select(
        "id, created_at, status, total_amount, currency, credit_amount, price_plan(name)"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (paymentsError) {
      throw paymentsError;
    }

    return (
      <div className="flex flex-col w-full gap-8 p-4">
        <div>
          <BackButton />
        </div>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h1 className="text-3xl font-medium ">All Purchases</h1>
          <Button asChild>
            <Link href={"/dashboard/buy-credits"}>
              Buy More Credits <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <PaymentsTable data={(payments as unknown as IPayment[]) || []} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
