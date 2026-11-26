import { AskBoxSkeleton, ListSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <AskBoxSkeleton />
      <ListSkeleton rows={4} action />
    </SectionSkeleton>
  );
}
