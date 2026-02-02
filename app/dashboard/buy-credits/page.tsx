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
      "id, product_id, credit_amount, amount, currency, name, description"
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
          <h2 className="text-3xl font-medium text-start tracking-tight">
            Buy AI Credits
          </h2>
          <p className="text-lg text-muted-foreground">
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
            className="flex flex-col p-6 text-center shadow-lg hover:shadow-xl transition-shadow duration-300"
          >
            <CardHeader className="p-0 mb-4">
              <CardTitle className="text-3xl font-bold text-primary">
                {plan.name}
              </CardTitle>
              <p className="text-muted-foreground">{plan.description}</p>
            </CardHeader>
            <CardContent className="p-0 space-y-4 flex-grow">
              <div className="text-6xl font-extrabold tracking-tighter">
                {plan.credit_amount}
              </div>
              <p className="text-sm font-semibold text-muted-foreground">
                AI Credits
              </p>
            </CardContent>
            <CardFooter className="p-0 mt-6">
              <CreditPurchaseButton
                productId={plan.product_id} // Pass the currency-specific Price ID
                creditAmount={plan.credit_amount}
                displayPrice={`${plan.currency} ${plan.amount}`}
                planId={plan.id}
              />
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
