import PaymentUpdateEmail from "@/emails/PaymentUpdateEmail";
import { sendEmail } from "@/utils/serverUtils";
import { TWebhookPaymentDetails } from "@/utils/types/payments.types";
import { render } from "@react-email/components";
// import { Resend } from "resend";

// const resend = new Resend(process.env.RESEND_API_KEY);

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

  // const { error } = await resend.emails.send({
  //   from: "GetHired <varun@devhub.co.in>", // Use a clean, dedicated sender email
  //   to: [email],
  //   subject: `Important: AI Credits Purchase Update for ${userName}`,
  //   html: emailHtml,
  //   text: emailText,
  // });

  // if (error) {
  //   return {
  //     error: error.message,
  //     success: false,
  //   };
  // }

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
