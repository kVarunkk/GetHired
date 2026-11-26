import { FormSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <FormSkeleton fields={2} />
      <FormSkeleton fields={2} />
    </SectionSkeleton>
  );
}
