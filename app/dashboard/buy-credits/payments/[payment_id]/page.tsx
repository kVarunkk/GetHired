import BackButton from "@/components/BackButton";
import Error from "@/components/Error";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ApplicationStatusBadge from "@/components/ApplicationStatusBadge";
import { formatCurrency } from "@/utils/utils";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Headset, Info } from "lucide-react";
import { DownloadInvoiceButton } from "@/components/DownloadInvoiceBtn";
import CopyBtn from "@/components/CopyBtn";
import { TPaymentStatus } from "@/utils/types";
import { TPaymentIdRecord } from "@/utils/types/payments.types";
import { notFound, unstable_rethrow } from "next/navigation";
import { isUuid } from "@/helpers/agent/auth";

export default async function PaymentIdPage({
  params,
}: {
  params: Promise<{ payment_id: string }>;
}) {
  try {
    const { payment_id } = await params;
    if (!isUuid(payment_id)) notFound();
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
      .maybeSingle();

    if (paymentsError) {
      throw paymentsError;
    }
    if (!payment) notFound();

    const paymentData = payment as unknown as TPaymentIdRecord;

    const plan = paymentData.price_plan;

    return (
      <div className="flex flex-col w-full gap-8 p-4">
        <div>
          <BackButton />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-5">
          <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight">
            Payment Details
          </h1>
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
          <div className="flex gap-2 text-sm text-muted-foreground border rounded-lg bg-muted/40 px-3 py-2.5">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              The status for this transaction is currently{" "}
              <strong className="font-medium text-foreground">Pending. </strong>
              We will inform you by email if and when the status changes to{" "}
              <strong className="font-medium text-foreground">
                Complete
              </strong>{" "}
              or <strong className="font-medium text-foreground">Failed</strong>
              . Please contact support in case of any issue.
            </p>
          </div>
        ) : (
          ""
        )}

        {/* --- Main Content Grid --- */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left Panel */}
          <div className="min-w-0 space-y-4 [overflow-wrap:anywhere] md:col-span-1">
            <Card className=" ">
              <CardContent className="p-0">
                <Tabs defaultValue="fulfillment" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 !rounded-b-none">
                    <TabsTrigger
                      value="fulfillment"
                      className="min-w-0 data-[state=active]:!bg-muted data-[state=active]:!shadow-none"
                    >
                      <span className="truncate">Fulfillment</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="billing"
                      className="min-w-0 data-[state=active]:!bg-muted data-[state=active]:!shadow-none"
                    >
                      <span className="truncate">Billing</span>
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="fulfillment" className="p-6">
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          Payment Status
                        </p>
                        <div className="text-sm text-muted-foreground">
                          <ApplicationStatusBadge
                            status={paymentData.status as TPaymentStatus}
                          />
                        </div>
                      </div>
                      {paymentData.failure_reason ? (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Error
                          </p>
                          <p className="text-sm text-destructive">
                            {paymentData.failure_reason}
                          </p>
                        </div>
                      ) : (
                        ""
                      )}
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Purchased on
                        </p>
                        <p className="text-sm">
                          {new Date(paymentData.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Credits Fulfillment Status
                        </p>
                        <p className="text-sm">
                          {paymentData.credits_fulfilled
                            ? "COMPLETE"
                            : "PENDING"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Credits Fulfillment Date
                        </p>
                        <p className="text-sm">
                          {paymentData.fulfillment_date
                            ? new Date(
                                paymentData.fulfillment_date,
                              ).toLocaleString()
                            : "N/A"}
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="billing" className="p-6">
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Name
                        </p>
                        <p className="text-sm capitalize">
                          {paymentData.customer?.name || "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Email{" "}
                        </p>
                        <p className="text-sm">
                          {paymentData.customer?.email || "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Phone Number
                        </p>
                        <p className="text-sm">
                          {paymentData.customer?.phone_number ||
                            "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Billing Address
                        </p>
                        {paymentData.billing ? (
                          <div className="text-sm">
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
                <CardTitle className="text-lg font-semibold tracking-tight">
                  Order Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center pb-4 ">
                  <div className=" flex flex-col gap-1 max-w-[50%]">
                    <div className="text-lg font-semibold">{plan?.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {plan?.description}
                    </div>
                  </div>
                  <span className="text-2xl font-semibold tracking-tight">
                    {paymentData.total_amount &&
                      paymentData.currency &&
                      formatCurrency(
                        paymentData.total_amount,
                        paymentData.currency,
                      )}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-y-2 pt-6 border-t border-border ">
                  <span className="font-medium">Credits Purchased:</span>
                  <span className="font-semibold text-right text-lg">
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
                  {/* <span className="font-medium">Payment Method:</span>
                  <span className="text-right">
                    {paymentData.payment_method || "Card/UPI"}
                  </span> */}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
