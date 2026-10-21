import { ForgotPasswordForm } from "@/components/forgot-password-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Your Password",
  description:
    "Get a link to reset your GetHired password.",
};

export default function Page() {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
