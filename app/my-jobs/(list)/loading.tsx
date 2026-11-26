import { TablePageSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <TablePageSkeleton actions={2} ask={false} columns={5} />;
}
