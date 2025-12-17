import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { DollarSign, XCircle, CheckCircle, Headset, Clock } from "lucide-react";
import { client } from "@/lib/dodo/initialize";
import { Payment } from "dodopayments/resources/payments.mjs";
import { formatCurrency } from "@/lib/utils";
import { DownloadInvoiceButton } from "@/components/DownloadInvoiceBtn";

export default async function CreditsStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParamsResolved = await searchParams;
  const paymentId = searchParamsResolved.payment_id as string | undefined;
  const status = searchParamsResolved.status as string | undefined;

  let paymentDetails: Payment | null = null;
  let fetchError: string | null = null;
  let isSuccess = status === "succeeded";
  let isPending = status === "processing";
  let isFailed =
    status === "failed" ||
    (!paymentId &&
      status !== "requires_customer_action" &&
      status !== "succeeded" &&
      status !== "processing");

  let title = "Transaction Status";
  let icon = <DollarSign className="w-8 h-8 text-gray-500" />;
  let cardBorderClass = "border-gray-500";

  if (paymentId) {
    try {
      paymentDetails = await client.payments.retrieve(paymentId);

      if (isSuccess) {
        title = "Purchase Successful!";
        icon = <CheckCircle className="w-12 h-12 text-green-500" />;
        cardBorderClass = "border-green-500";
      } else if (isPending) {
        title = "Transaction is Pending";
        icon = <Clock className="w-12 h-12 text-yellow-500" />;
        cardBorderClass = "border-yellow-500";
      } else {
        title = "Transaction Failed";
        icon = <XCircle className="w-12 h-12 text-red-500" />;
        cardBorderClass = "border-red-500";
      }
    } catch {
      fetchError =
        "Could not retrieve payment details. Check payment_id or contact support.";
      title = "Lookup Error";
      isSuccess = false;
      isPending = false;
      isFailed = true;
      cardBorderClass = "border-red-500";
      icon = <XCircle className="w-12 h-12 text-red-500" />;
    }
  } else if (status === "cancelled") {
    title = "Purchase Cancelled";
    cardBorderClass = "border-gray-300";
    icon = <XCircle className="w-12 h-12 text-gray-400" />;
    isFailed = true; // Treat cancellation as a non-success/non-pending state for CTA
  }

  // Determine card border color based on final status
  let finalBorderClass = cardBorderClass;
  if (isSuccess) {
    finalBorderClass = "border-green-500";
  } else if (isPending) {
    finalBorderClass = "border-yellow-500";
  } else if (isFailed) {
    finalBorderClass = "border-red-500";
  }

  // --- Render Logic ---
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] sm:p-4">
      <Card
        className={`w-full max-w-lg shadow-2xl ${finalBorderClass} border-t-8`}
      >
        <CardHeader className="text-center pb-4 space-y-3">
          <div className="flex justify-center mb-4">{icon}</div>
          <CardTitle className="text-3xl font-bold">{title}</CardTitle>
          <CardDescription>
            {isSuccess
              ? "Thank you for your purchase! Your AI credits have been credited to your account. Check your email for the transaction receipt."
              : isPending
                ? "Your transaction is currently being processed by the payment gateway. Credits will be available shortly after confirmation. This may take a few minutes."
                : "Unfortunately, your transaction was not successful. " +
                  (paymentDetails?.error_message
                    ? "Reason: " + paymentDetails?.error_message
                    : "Please review your payment details and try again.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {fetchError && (
            <div className="p-4 bg-red-100 text-red-700 rounded-lg">
              {fetchError}
            </div>
          )}

          {paymentDetails && (
            <>
              {/* Summary Box */}
              <div className="border rounded-lg p-4 space-y-2">
                <h3 className="text-xl font-semibold mb-2">Order Summary</h3>

                <div className="flex justify-between flex-wrap items-center">
                  <span className="text-muted-foreground">
                    AI Credits Purchased:
                  </span>
                  <span className="font-bold text-lg text-primary">
                    {paymentDetails.metadata.credit_amount}
                  </span>
                </div>
                <div className="flex justify-between flex-wrap items-center">
                  <span className="text-muted-foreground">Amount Charged:</span>
                  <span className="font-bold text-lg">
                    {formatCurrency(
                      paymentDetails.total_amount,
                      paymentDetails.currency
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-sm flex-wrap items-center">
                  <span className="text-muted-foreground">Payment Method:</span>
                  <span>{paymentDetails.payment_method}</span>
                </div>
              </div>

              {/* Billing Details */}
              <div className="border rounded-lg p-4 space-y-2 text-sm">
                <h3 className="text-lg font-semibold mb-2">
                  Billing & Customer
                </h3>
                <p>
                  <strong>Email:</strong> {paymentDetails.customer.email}
                </p>
                <p>
                  <strong>Billing Country:</strong>{" "}
                  {paymentDetails.billing.country}
                </p>
                <p>
                  <strong>Transaction ID:</strong> {paymentDetails.payment_id}
                </p>
                <p>
                  <strong>Date:</strong>{" "}
                  {new Date(paymentDetails.created_at).toLocaleDateString()}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3 pt-4">
                {isSuccess || isPending ? ( // Show invoice button if succeeded or processing has started
                  <DownloadInvoiceButton
                    paymentId={paymentDetails.payment_id}
                    isPaymentStatusPage={true}
                  />
                ) : (
                  <Link href="/dashboard/buy-credits" className="w-full block">
                    <Button variant={"outline"} className="w-full ">
                      Retry Purchase
                    </Button>
                  </Link>
                )}
                <Link
                  href="/dashboard/buy-credits/payments/"
                  className="w-full block"
                >
                  <Button className="w-full ">More Details</Button>
                </Link>
                <Link href="/jobs" className="w-full block">
                  <Button variant="secondary" className="w-full ">
                    Continue Job Search
                  </Button>
                </Link>
                <Link href="mailto:varun@devhub.co.in" className="w-full block">
                  <Button
                    variant="link"
                    className="w-full text-muted-foreground"
                  >
                    <Headset className="w-4 h-4 mr-2" />
                    Contact Support
                  </Button>
                </Link>
              </div>
            </>
          )}
          {/* Fallback for cancelled status */}
          {status === "cancelled" && !paymentDetails && (
            <div className="text-center p-4">
              <p className="text-lg text-muted-foreground">
                You cancelled the checkout process. Your account has not been
                charged.
              </p>
              <Link href="/dashboard/buy-credits" className="w-full block mt-4">
                <Button>Return to Credit Purchase</Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
