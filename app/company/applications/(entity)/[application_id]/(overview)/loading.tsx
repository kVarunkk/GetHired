import { AskBoxSkeleton, CardSkeleton, DocumentSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="p-0">
      <AskBoxSkeleton />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <DocumentSkeleton className="lg:col-span-2" />
        <CardSkeleton lines={6} />
      </div>
    </SkeletonPage>
  );
}
