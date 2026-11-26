import { ListSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <ListSkeleton rows={4} action />
    </SectionSkeleton>
  );
}
