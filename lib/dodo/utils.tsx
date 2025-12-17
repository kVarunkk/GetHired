import PaymentUpdateEmail from "@/emails/PaymentUpdateEmail";
import { render } from "@react-email/components";
import { IPayment } from "../types";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function SendPaymentUpdateEmail({
  userName,
  email,
  paymentDetails,
}: {
  userName: string;
  email: string;
  paymentDetails: IPayment;
}) {
  const emailHtml = await render(
    <PaymentUpdateEmail userName={userName} paymentDetails={paymentDetails} />
  );

  const emailText = await render(
    <PaymentUpdateEmail userName={userName} paymentDetails={paymentDetails} />,
    {
      plainText: true,
    }
  );

  const { error } = await resend.emails.send({
    from: "GetHired <varun@devhub.co.in>", // Use a clean, dedicated sender email
    to: [email],
    subject: `Important: AI Credits Purchase Update for ${userName}`,
    html: emailHtml,
    text: emailText,
  });

  if (error) {
    return {
      error: error.message,
      success: false,
    };
  }

  return {
    error: null,
    success: true,
  };
}
