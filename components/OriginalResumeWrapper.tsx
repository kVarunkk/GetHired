"use client";

import dynamic from "next/dynamic";

const OriginalResumeViewer = dynamic(
  () => import("@/components/OriginalResumeViewer"),
  { ssr: false },
);

export default function OriginalResumeWrapper({ url }: { url: string }) {
  return <OriginalResumeViewer url={url} />;
}
