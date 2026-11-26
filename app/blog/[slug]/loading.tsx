import { DocumentSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-3xl">
      <HeaderSkeleton back eyebrow />
      <DocumentSkeleton sections={4} className="border-0 p-0" />
    </SkeletonPage>
  );
}
