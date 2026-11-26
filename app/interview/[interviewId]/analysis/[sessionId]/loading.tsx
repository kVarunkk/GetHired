import { CardGridSkeleton, DocumentSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-4xl">
      <HeaderSkeleton back />
      <CardGridSkeleton count={3} lines={2} />
      <DocumentSkeleton sections={3} />
    </SkeletonPage>
  );
}
