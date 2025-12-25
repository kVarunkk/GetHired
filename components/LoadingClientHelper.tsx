"use client";

import { useSearchParams } from "next/navigation";

export default function LoadingClientHelper() {
  const params = useSearchParams();
  if (params.get("jobId")) {
    return (
      <div>
        Our AI is finding the best listings for you. It might take a moment...
      </div>
    );
  } else return "";
}
