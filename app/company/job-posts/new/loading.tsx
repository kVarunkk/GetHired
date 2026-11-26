import { FormSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="max-w-4xl">
      <HeaderSkeleton back />
      <FormSkeleton fields={7} />
    </SkeletonPage>
  );
}
