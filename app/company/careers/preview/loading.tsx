import { DocumentSkeleton, HeaderSkeleton, ListSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-4xl">
      <HeaderSkeleton />
      <DocumentSkeleton sections={2} />
      <ListSkeleton rows={4} />
    </SkeletonPage>
  );
}
