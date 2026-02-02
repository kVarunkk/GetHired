"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        router.back();
      }}
      className="text-muted-foreground hover:text-primary transition-colors "
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  );
}
