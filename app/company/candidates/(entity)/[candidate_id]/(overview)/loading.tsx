import { FormSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <FormSkeleton fields={6} />
    </SectionSkeleton>
  );
}
