import {
  AskBoxSkeleton,
  DocumentSkeleton,
  FormSkeleton,
  HeaderSkeleton,
  SkeletonPage,
} from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage>
      <HeaderSkeleton back actions={2} />
      <AskBoxSkeleton />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FormSkeleton fields={6} />
        <DocumentSkeleton />
      </div>
    </SkeletonPage>
  );
}
