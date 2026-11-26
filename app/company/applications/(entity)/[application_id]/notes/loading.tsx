import { Skeleton } from "@/components/ui/skeleton";
import { ListSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <Skeleton aria-hidden className="h-24 w-full rounded-xl" />
      <ListSkeleton rows={3} />
    </SectionSkeleton>
  );
}
