import { FormSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-3xl">
      <HeaderSkeleton />
      <FormSkeleton fields={5} />
    </SkeletonPage>
  );
}
