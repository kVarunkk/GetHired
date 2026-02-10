export default function Loading() {
  // Add fallback UI that will be shown while the route is loading.
  return (
    <div className="h-screen w-full flex items-center justify-center text-muted-foreground">
      Loading...
    </div>
  );
}
