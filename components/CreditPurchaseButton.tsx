"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";

interface CreditPurchaseButtonProps {
  /** Display only: the server reads the amount from the plan. */
  creditAmount: number;
  displayPrice: string;
  planId: string;
}

const CreditPurchaseButton: React.FC<CreditPurchaseButtonProps> = ({
  creditAmount,
  displayPrice,
  planId,
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const handlePurchase = async () => {
    setIsLoading(true);
    toast.loading(`Preparing checkout for ${creditAmount} credits...`);

    try {
      const response = await fetch("/api/dodo/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to create checkout session.");
      }

      // Redirect to the Dodo Checkout page
      window.location.assign(data.checkoutUrl);
    } catch (error) {
      toast.dismiss();
      toast.error(`Purchase failed: ${(error as Error).message}`);
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handlePurchase}
      disabled={isLoading}
      variant="brand"
      className="w-full h-11"
    >
      {isLoading ? "Processing..." : `Buy for ${displayPrice}`}
    </Button>
  );
};

export default CreditPurchaseButton;
