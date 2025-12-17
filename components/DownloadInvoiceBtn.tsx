"use client";

import Link from "next/link";
import { Button } from "./ui/button";
import { Download } from "lucide-react";

export const DownloadInvoiceButton = ({
  paymentId,
  isPaymentStatusPage,
}: {
  paymentId: string;
  isPaymentStatusPage: boolean;
}) => {
  return (
    <Link
      href={`/api/dodo/download-invoice/${paymentId}`}
      download
      target="_blank"
      className={isPaymentStatusPage ? "w-full" : ""}
    >
      <Button
        variant={isPaymentStatusPage ? "outline" : "default"}
        className="w-full "
      >
        <Download className="w-4 h-4 mr-2" />
        Download Invoice
      </Button>
    </Link>
  );
};
