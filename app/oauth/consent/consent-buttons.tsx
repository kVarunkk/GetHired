"use client";

import { useFormStatus } from "react-dom";

export function ConsentButtons() {
  const { pending } = useFormStatus();

  return (
    <div className="flex gap-3">
      <button
        type="submit"
        name="decision"
        value="approve"
        disabled={pending}
        className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 disabled:opacity-50"
      >
        {pending ? "Authorizing..." : "Approve"}
      </button>

      <button
        type="submit"
        name="decision"
        value="deny"
        disabled={pending}
        className="flex-1 border rounded px-4 py-2 disabled:opacity-50"
      >
        {pending ? "Processing..." : "Deny"}
      </button>
    </div>
  );
}
