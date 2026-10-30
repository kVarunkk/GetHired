"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function ConsentButtons() {
  const { pending } = useFormStatus();

  return (
    <div className="flex gap-3">
      <Button
        type="submit"
        name="decision"
        value="approve"
        variant="brand"
        disabled={pending}
        className="flex-1"
      >
        {pending ? "Authorizing..." : "Approve"}
      </Button>

      <Button
        type="submit"
        name="decision"
        value="deny"
        variant="outline"
        disabled={pending}
        className="flex-1"
      >
        {pending ? "Processing..." : "Deny"}
      </Button>
    </div>
  );
}
