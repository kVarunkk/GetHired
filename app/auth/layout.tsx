// import NavbarParent from "@/components/NavbarParent";
import { ReactNode } from "react";
import { Metadata } from "next";
// import { v4 as uuidv4 } from "uuid";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="mb-20">{children}</div>;
}
