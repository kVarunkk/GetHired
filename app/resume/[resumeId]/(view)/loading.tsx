import { AskBoxSkeleton, DocumentSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage>
      <HeaderSkeleton back actions={2} />
      <AskBoxSkeleton />
      <DocumentSkeleton sections={4} className="mx-auto max-w-3xl" />
    </SkeletonPage>
  );
}
