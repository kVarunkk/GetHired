import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import CreditPurchaseButton from "@/components/CreditPurchaseButton";
import Error from "@/components/Error";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default async function BuyCreditsPage() {
  const supabase = await createClient();

  const { data: plans, error } = await supabase
    .from("price_plan")
    .select(
      "id, product_id, credit_amount, amount, currency, name, description",
    )
    .order("credit_amount", { ascending: true });

  if (error || !plans || plans.length === 0) {
    return <Error />;
  }

  return (
    <div className="flex flex-col w-full gap-8 p-4">
      <div>
        <BackButton />
      </div>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl sm:text-[28px] font-semibold text-start tracking-tight">
            Buy AI Credits
          </h2>
          <p className="text-[15px] leading-7 text-muted-foreground">
            Instantly top up your account to continue using AI features.
          </p>
        </div>

        <Button asChild variant={"outline"}>
          <Link href={"/dashboard/buy-credits/payments"}>
            View Purchase History
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <Card
            key={plan.id}
            className="flex flex-col p-6 text-center transition-colors duration-300 hover:border-foreground/20"
          >
            <CardHeader className="p-0 mb-4">
              <CardTitle className="text-lg font-semibold tracking-tight">
                {plan.name}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {plan.description}
              </p>
            </CardHeader>
            <CardContent className="p-0 space-y-4 flex-grow">
              <div className="text-5xl font-semibold tracking-tight">
                {plan.credit_amount}
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                AI Credits
              </p>
            </CardContent>
            <CardFooter className="p-0 mt-6">
              {plan.product_id && plan.credit_amount && (
                <CreditPurchaseButton
                  productId={plan.product_id}
                  creditAmount={plan.credit_amount}
                  displayPrice={`${plan.currency} ${plan.amount}`}
                  planId={plan.id}
                />
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
