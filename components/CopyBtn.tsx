"use client";

import { copyToClipboard } from "@/lib/utils";
import { Copy } from "lucide-react";

export default function CopyBtn({ content }: { content: string }) {
  return (
    <button
      className="shrink-0"
      onClick={() =>
        copyToClipboard(content, "Transaction ID copied to clipboard!")
      }
    >
      <Copy className="h-3 w-3" />
    </button>
  );
}
