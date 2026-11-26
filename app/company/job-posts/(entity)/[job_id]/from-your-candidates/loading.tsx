import { ListSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton actions={1}>
      <ListSkeleton rows={6} action />
    </SectionSkeleton>
  );
}
