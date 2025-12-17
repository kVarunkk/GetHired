import BackButton from "@/components/BackButton";
import Error from "@/components/Error";
import { createClient } from "@/lib/supabase/server";
import { IPayment } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ApplicationStatusBadge from "@/components/ApplicationStatusBadge";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Headset, Info } from "lucide-react";
import { DownloadInvoiceButton } from "@/components/DownloadInvoiceBtn";
import CopyBtn from "@/components/CopyBtn";

export default async function PaymentIdPage({
  params,
}: {
  params: Promise<{ payment_id: string }>;
}) {
  try {
    const { payment_id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw "User not authenticated.";
    }

    const { data: payment, error: paymentsError } = await supabase
      .from("payments")
      .select("*, price_plan(*)")
      .eq("id", payment_id)
      .single();

    if (paymentsError) {
      throw paymentsError;
    }

    const paymentData = payment as unknown as IPayment;
    const plan = paymentData.price_plan;

    return (
      <div className="flex flex-col w-full gap-8">
        <div>
          <BackButton />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-5">
          <h1 className="text-3xl font-medium">Payment Details</h1>
          <div className="flex items-center gap-4 flex-wrap">
            <Link href="mailto:varun@devhub.co.in">
              <Button variant="link" className="w-full ">
                <Headset className="w-4 h-4 mr-2" />
                Contact Support
              </Button>
            </Link>
            {paymentData.payment_id ? (
              <DownloadInvoiceButton
                paymentId={paymentData.payment_id}
                isPaymentStatusPage={false}
              />
            ) : (
              ""
            )}
          </div>
        </div>

        {paymentData.status === "pending" ? (
          <div className="flex  gap-2 text-sm text-muted-foreground border border-border rounded-lg bg-secondary p-2">
            <Info className="h-4 w-4 shrink-0 mt-[2px]" />
            <p>
              The status for this transaction is currently{" "}
              <strong>Pending. </strong> We will inform you by email if and when
              the status changes to <strong>Complete</strong> or{" "}
              <strong>Failed</strong>. Please contact support in case of any
              issue.
            </p>
          </div>
        ) : (
          ""
        )}

        {/* --- Main Content Grid --- */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left Panel */}
          <div className="md:col-span-1 space-y-4">
            <Card className=" ">
              <CardContent className="p-0">
                <Tabs defaultValue="fulfillment" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 !rounded-b-none">
                    <TabsTrigger
                      value="fulfillment"
                      className="data-[state=active]:!bg-muted data-[state=active]:!shadow-none"
                    >
                      Fulfillment Details
                    </TabsTrigger>
                    <TabsTrigger
                      value="billing"
                      className="data-[state=active]:!bg-muted data-[state=active]:!shadow-none"
                    >
                      Billing Details
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="fulfillment" className="p-6">
                    <div className="space-y-4">
                      <div>
                        <p className="font-semibold text-sm mb-1">
                          Payment Status
                        </p>
                        <div className="text-sm text-muted-foreground">
                          <ApplicationStatusBadge status={paymentData.status} />
                        </div>
                      </div>
                      {paymentData.failure_reason ? (
                        <div>
                          <p className="font-semibold text-sm">Error</p>
                          <p className="text-sm text-red-600">
                            {paymentData.failure_reason}
                          </p>
                        </div>
                      ) : (
                        ""
                      )}
                      <div>
                        <p className="font-semibold text-sm">Purchased on</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(paymentData.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          Credits Fulfillment Status
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {paymentData.credits_fulfilled
                            ? "COMPLETE"
                            : "PENDING"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          Credits Fulfillment Date
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {paymentData.fulfillment_date
                            ? new Date(
                                paymentData.fulfillment_date
                              ).toLocaleString()
                            : "N/A"}
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="billing" className="p-6">
                    <div className="space-y-4">
                      <div>
                        <p className="font-semibold text-sm">Name</p>
                        <p className="text-sm text-muted-foreground capitalize">
                          {paymentData.customer?.name || "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">Email </p>
                        <p className="text-sm text-muted-foreground">
                          {paymentData.customer?.email || "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">Phone Number</p>
                        <p className="text-sm text-muted-foreground">
                          {paymentData.customer?.phone_number ||
                            "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">Billing Address</p>
                        {paymentData.billing ? (
                          <div className="text-sm text-muted-foreground">
                            <p>{paymentData.billing.street}</p>
                            <p>
                              {paymentData.billing.city},{" "}
                              {paymentData.billing.state}{" "}
                              {paymentData.billing.zipcode}
                            </p>
                            <p>{paymentData.billing.country}</p>
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            Not specified
                          </div>
                        )}
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
          {/* Right Panel */}
          <div className="md:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center pb-4 ">
                  <div className=" flex flex-col gap-1 max-w-[50%]">
                    <div className="text-lg font-semibold">{plan?.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {plan?.description}
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-primary">
                    {formatCurrency(
                      paymentData.total_amount,
                      paymentData.currency
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-y-2 pt-6 border-t border-border ">
                  <span className="font-medium">Credits Purchased:</span>
                  <span className="font-bold text-right text-lg">
                    {paymentData.credit_amount}
                  </span>
                  <span className="font-medium">Transaction ID:</span>
                  <div className="flex items-center gap-1 justify-end">
                    <span className="text-right text-xs truncate">
                      {paymentData.payment_id || "N/A"}
                    </span>
                    {paymentData.payment_id ? (
                      <CopyBtn content={paymentData.payment_id} />
                    ) : (
                      ""
                    )}
                  </div>
                  <span className="font-medium">Payment Method:</span>
                  <span className="text-right">
                    {paymentData.payment_method || "Card/UPI"}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.log(error);
    return <Error />;
  }
}
