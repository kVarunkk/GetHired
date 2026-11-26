import {
  AskBoxSkeleton,
  CardSkeleton,
  HeaderSkeleton,
  SkeletonPage,
  TitledListSkeleton,
} from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="max-w-3xl">
      <HeaderSkeleton />
      <AskBoxSkeleton />
      <TitledListSkeleton rows={2} action />
      <CardSkeleton lines={3} />
    </SkeletonPage>
  );
}
