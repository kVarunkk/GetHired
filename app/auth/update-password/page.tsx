import { UpdatePasswordForm } from "@/components/update-password-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Set a New Password",
  description:
    "Choose a new password for your GetHired account.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <UpdatePasswordForm />
      </div>
    </div>
  );
}
