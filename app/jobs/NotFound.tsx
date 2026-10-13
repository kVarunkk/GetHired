import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="h-full w-full flex items-center justify-center flex-col gap-10 p-4">
      <div className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Lost in the Stack?
        </h1>
        <p className="text-muted-foreground">
          The page you are looking for does not exist.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <Button asChild variant={"outline"}>
          <Link href={"/"}>Home</Link>
        </Button>
        <Button asChild variant="brand">
          <Link href={"/jobs"}>Browse Jobs</Link>
        </Button>
      </div>
    </div>
  );
}
