import * as React from "react";
import { BaseEmailLayout } from "./BaseEmailLayout";
import { Heading, Text, Section, Button, Hr } from "@react-email/components";
import { formatCurrency } from "@/lib/utils";
import { IPayment } from "@/lib/types";

interface PaymentUpdateEmailProps {
  userName: string;
  paymentDetails: IPayment;
}

export const PaymentUpdateEmail = ({
  userName,
  paymentDetails,
}: PaymentUpdateEmailProps) => {
  let headingText: string;
  let bodyContent: React.ReactNode;
  let ctaLabel: string;
  let ctaLink: string;
  let headingColor: string;

  const baseLink = "https://gethired.devhub.co.in";

  const renderOrderSummary = (
    details: IPayment,
    color: string,
    successMessage: string
  ) => {
    const formattedAmount = formatCurrency(
      details.total_amount,
      details.currency
    );

    return (
      <>
        <Text className="text-base text-gray-700 mb-6 ">
          Hi {userName}, {successMessage}
        </Text>

        <Section
          className="bg-gray-50 border border-gray-200 rounded-lg p-5"
          style={{
            backgroundColor: "#f9fafb",
            padding: "20px",
            borderRadius: "8px",
          }}
        >
          <Text
            className="text-lg font-bold mb-3 text-gray-800"
            style={{ fontWeight: "700", fontSize: "18px" }}
          >
            Order Summary
          </Text>
          <Hr
            className="border-t border-gray-300 my-3"
            style={{ borderColor: "#e5e7eb", margin: "15px 0" }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "justify-between",
              marginBottom: "8px",
            }}
          >
            <Text
              className="text-base text-gray-600 my-0"
              style={{ color: "#4b5563", margin: "0" }}
            >
              Item Purchased:
            </Text>
            <Text
              className="text-base font-semibold my-0"
              style={{ fontWeight: "600", margin: "0" }}
            >
              {details.credit_amount} AI Credits
            </Text>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "justify-between",
              marginBottom: "8px",
            }}
          >
            <Text
              className="text-base text-gray-600 my-0"
              style={{ color: "#4b5563", margin: "0" }}
            >
              Total Charged:
            </Text>
            <Text
              className="text-base font-bold my-0"
              style={{ fontWeight: "700", margin: "0" }}
            >
              {formattedAmount}
            </Text>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "justify-between",
              marginBottom: "8px",
            }}
          >
            <Text
              className="text-base text-gray-600 my-0"
              style={{ color: "#4b5563", margin: "0" }}
            >
              Payment Method:
            </Text>
            <Text className="text-base my-0" style={{ margin: "0" }}>
              {details.payment_method}
            </Text>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "justify-between",
              marginBottom: "8px",
            }}
          >
            <Text
              className="text-base text-gray-600 my-0"
              style={{ color: "#4b5563", margin: "0" }}
            >
              Transaction ID:
            </Text>
            <Text
              className="text-base my-0"
              style={{ fontSize: "12px", wordBreak: "break-all", margin: "0" }}
            >
              {details.payment_id}
            </Text>
          </div>
        </Section>
      </>
    );
  };

  switch (paymentDetails.status) {
    case "complete":
      headingColor = "#059669"; // Green-600
      headingText = `Payment Successful! 🎉`;
      // previewText = `Your purchase of ${paymentDetails?.credit_amount} credits is confirmed.`;
      ctaLabel = "View More Details";
      ctaLink = `${baseLink}/dashboard/buy-credits/payments/${paymentDetails.payment_id}`;

      if (paymentDetails) {
        bodyContent = (
          <>
            {renderOrderSummary(
              paymentDetails,
              headingColor,
              `your purchase has been successfully processed, and ${paymentDetails.credit_amount} AI credits have been added to your account instantly!`
            )}
            <Text className="text-base text-gray-700 mt-6">
              You can now use these credits for our premium AI features,
              including AI Smart Search, Ask AI and more.
            </Text>
          </>
        );
      } else {
        bodyContent = (
          <Text>
            Your payment was successful, but we are missing some transaction
            details. Please check your dashboard or contact support.
          </Text>
        );
      }
      break;

    case "pending":
      headingColor = "#eab308"; // Amber-600 (Requested color: #eab308)
      headingText = `Payment Is Processing... ⏱️`;
      // previewText = `Your payment is currently being processed.`;
      ctaLabel = "View More Details";
      ctaLink = `${baseLink}/dashboard/buy-credits/payments/${paymentDetails.payment_id}`;

      if (paymentDetails) {
        bodyContent = (
          <>
            {renderOrderSummary(
              paymentDetails,
              headingColor,
              `we are currently processing your purchase of ${paymentDetails.credit_amount} AI credits.`
            )}
            <Text className="text-base text-gray-700 mt-6">
              You will receive a second email confirmation as soon as the funds
              are settled by the bank. This may take a few minutes to a few
              hours, depending on your payment method. Thank you for your
              patience!
            </Text>
          </>
        );
      } else {
        bodyContent = (
          <Text>
            We are processing your payment. We will notify you when it is
            complete.
          </Text>
        );
      }
      break;

    case "failed":
      headingColor = "#dc2626"; // Red-600
      headingText = `Payment Failed`;
      // previewText = `There was an issue processing your payment.`;
      ctaLabel = "View More Details";
      ctaLink = `${baseLink}/dashboard/buy-credits/payments/${paymentDetails.payment_id}`;

      if (paymentDetails) {
        bodyContent = (
          <>
            {renderOrderSummary(
              paymentDetails,
              headingColor,
              `unfortunately, your recent payment attempt for ${paymentDetails.credit_amount} AI credits was unsuccessful.`
            )}
            <Text className="text-base text-gray-700 mt-6">
              Please review your card details, check with your bank, or try
              purchasing again with an alternative method. If the problem
              persists, please use the contact support link below.
            </Text>
          </>
        );
      } else {
        bodyContent = (
          <Text className="text-base text-gray-700 mb-6 ">
            Hi {userName}, unfortunately, your recent payment attempt was
            unsuccessful. No charges were made to your account.
            <br />
            <br />
            Please review your payment information and try purchasing your AI
            credits again. If the problem persists, please use the contact
            support link below.
          </Text>
        );
      }
      break;

    case "cancelled":
    default:
      headingColor = "#b45309"; // Amber-700
      headingText = `Purchase Cancelled`;
      // previewText = `You closed the checkout window.`;
      ctaLabel = paymentDetails.payment_id
        ? "View More Details"
        : "Continue Purchase";
      ctaLink = paymentDetails.payment_id
        ? `${baseLink}/dashboard/buy-credits/payments/${paymentDetails.payment_id}`
        : `${baseLink}/dashboard/buy-credits`;
      bodyContent = (
        <Text className="text-base text-gray-700 mb-6 ">
          Hi {userName}, it looks like you closed the payment window before
          completing your purchase. Your account has not been charged, and no
          credits have been added.
          <br />
          <br />
          Click the button below to resume your purchase of AI credits and
          unlock premium job search features.
        </Text>
      );
      break;
  }

  return (
    <BaseEmailLayout previewText={""}>
      <Heading
        className="text-3xl font-bold my-6"
        style={{
          color: headingColor,
          fontSize: "30px",
          fontWeight: "700",
          margin: "24px 0",
        }}
      >
        {headingText}
      </Heading>

      {/* Main Content Body */}
      {bodyContent}

      {/* CTA Button (Primary Action) */}
      <Section
        className="text-center my-10"
        style={{ textAlign: "center", margin: "40px 0" }}
      >
        <Button
          href={ctaLink}
          className="bg-black text-white link-color py-3 px-6 rounded-md text-lg font-bold no-underline"
          style={{
            backgroundColor: "#000000",
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: "6px",
            fontSize: "18px",
            fontWeight: "700",
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          {ctaLabel}
        </Button>
      </Section>

      {/* Secondary CTA (Support) */}
      <Text
        className="text-base text-gray-700 mb-6"
        style={{ color: "#4b5563" }}
      >
        If you have any questions about this transaction or encountered an
        error, please contact{" "}
        <a
          href={`mailto:varun@devhub.co.in`}
          style={{ textDecoration: "underline" }}
        >
          here
        </a>
        .
      </Text>

      <Text
        className="text-base text-gray-700 mt-10 "
        style={{ color: "#4b5563", marginTop: "40px" }}
      >
        Best regards,
        <br />
        The GetHired Team
      </Text>
    </BaseEmailLayout>
  );
};

export default PaymentUpdateEmail;
