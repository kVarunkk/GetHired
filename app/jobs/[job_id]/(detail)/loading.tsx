import { CardSkeleton, DocumentSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage>
      <HeaderSkeleton back eyebrow actions={2} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <DocumentSkeleton className="lg:col-span-2" />
        <CardSkeleton lines={6} />
      </div>
    </SkeletonPage>
  );
}
