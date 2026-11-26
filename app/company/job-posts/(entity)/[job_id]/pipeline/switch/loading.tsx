import { FormSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton back>
      <FormSkeleton fields={4} />
    </SectionSkeleton>
  );
}
