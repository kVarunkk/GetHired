import PaymentUpdateEmail from "@/emails/PaymentUpdateEmail";
import { sendEmail } from "@/utils/email";
import { TWebhookPaymentDetails } from "@/utils/types/payments.types";
import { render } from "@react-email/components";

export async function SendPaymentUpdateEmail({
  userName,
  email,
  paymentDetails,
}: {
  userName: string;
  email: string;
  paymentDetails: TWebhookPaymentDetails;
}) {
  const emailHtml = await render(
    <PaymentUpdateEmail userName={userName} paymentDetails={paymentDetails} />,
  );

  const emailText = await render(
    <PaymentUpdateEmail userName={userName} paymentDetails={paymentDetails} />,
    {
      plainText: true,
    },
  );

  await sendEmail({
    toEmail: email,
    subject: `Important: AI Credits Purchase Update for ${userName}`,
    htmlContent: emailHtml,
    textContent: emailText,
  });

  return {
    error: null,
    success: true,
  };
}
