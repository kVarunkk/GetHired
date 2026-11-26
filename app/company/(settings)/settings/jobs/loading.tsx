import { CardSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <CardSkeleton lines={3} />
    </SectionSkeleton>
  );
}
