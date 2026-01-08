import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="h-full w-full flex items-center justify-center flex-col gap-10 p-4">
      <div className="flex flex-col gap-3 text-center">
        <h1 className="font-bold text-5xl">Lost in the Stack?</h1>
        <p className="text-muted-foreground">
          The page you are looking for does not exist.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <Button asChild variant={"secondary"}>
          <Link href={"/"}>Back Home</Link>
        </Button>
        <Button asChild>
          <Link href={"/jobs"}>Browse Jobs</Link>
        </Button>
      </div>
    </div>
  );
}
