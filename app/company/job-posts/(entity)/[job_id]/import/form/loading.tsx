import { FormSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="p-0">
      <FormSkeleton fields={6} />
    </SkeletonPage>
  );
}
