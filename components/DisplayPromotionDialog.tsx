"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import PromotionAlertDialog from "./PromotionAlertDialog";
import { createClient } from "@/lib/supabase/client";

interface DisplayPromotionProps {
  currentUserId: string;
  featureData: {
    title: string;
    description: string;
    confirmButtonLabel: string;
    featureHighlight?: string;
    promoImage?: string;
    customContent?: React.ReactNode;
    currentDialogId: string;
  };
}

export default function DisplayPromotion({
  currentUserId,
  featureData,
}: DisplayPromotionProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  const fetchAndCheckDialogStatus = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("user_info")
      .select("last_promo_version_seen")
      .eq("user_id", currentUserId)
      .single();

    if (data && data.last_promo_version_seen !== featureData.currentDialogId) {
      setShowDialog(true);
    }
    setIsDataLoaded(true);
  }, [currentUserId]);

  useEffect(() => {
    if (currentUserId) {
      fetchAndCheckDialogStatus();
    }
  }, [currentUserId, fetchAndCheckDialogStatus]);

  const handleUpdatePreferences = useCallback(
    async (updates: { last_promo_version_seen: string }) => {
      const supabase = createClient();
      await supabase
        .from("user_info")
        .update({ last_promo_version_seen: updates.last_promo_version_seen })
        .eq("user_id", currentUserId);
    },
    [currentUserId]
  );

  if (!isDataLoaded) {
    return null;
  }

  return (
    <PromotionAlertDialog
      isOpen={showDialog}
      onClose={() => setShowDialog(false)}
      onUpdate={handleUpdatePreferences}
      textContent={featureData}
      customContent={featureData.customContent}
      promoImage={featureData.promoImage}
      currentDialogId={featureData.currentDialogId}
    />
  );
}
