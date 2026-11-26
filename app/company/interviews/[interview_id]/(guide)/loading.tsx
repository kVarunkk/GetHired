import { ListSkeleton, SectionSkeleton, TitledListSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <ListSkeleton rows={5} />
      <TitledListSkeleton rows={2} />
    </SectionSkeleton>
  );
}
