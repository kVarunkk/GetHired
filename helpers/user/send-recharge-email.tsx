import RechargeEmail from "@/emails/RechargeEmail";
import { sendEmail } from "@/utils/email";
import { render } from "@react-email/components";

export const sendEmailForRecharge = async (email: string, name: string) => {
  try {
    const emailHtml = await render(<RechargeEmail userName={name} />);

    const emailText = await render(<RechargeEmail userName={name} />, {
      plainText: true,
    });

    await sendEmail({
      toEmail: email,
      subject: `Important: Your AI Smart Search Job Feed and Daily Digest is Paused!`,
      htmlContent: emailHtml,
      textContent: emailText,
    });

    return {
      success: true,
    };
  } catch {
    console.error(
      "Some error occured while sending status update email to Varun Kumawat",
    );
    return {
      success: false,
    };
  }
};
