import { ListSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <ListSkeleton rows={6} />
    </SectionSkeleton>
  );
}
