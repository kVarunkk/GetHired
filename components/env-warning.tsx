export default function EnvWarning({
  geistClassname,
}: {
  geistClassname: string;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistClassname} flex items-center justify-center min-h-screen bg-background text-foreground p-6 font-sans antialiased`}
      >
        <div className="max-w-md w-full border rounded-2xl p-8 bg-card relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-warning" />

          <div className="w-12 h-12 rounded-xl bg-warning/10 border border-warning/30 flex items-center justify-center mb-6 text-warning">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </div>

          <h1 className="text-xl font-semibold mb-3 tracking-tight">
            Configuration Required
          </h1>
          <p className="mb-6 text-muted-foreground leading-relaxed text-sm">
            You do not have the required environment variables. Please add all
            required environment variables in your{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">
              .env.local
            </code>{" "}
            file to run the project.
          </p>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Once you have configured the{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-foreground">
              .env.local
            </code>{" "}
            file, restart your development server (
            <code className="bg-muted px-1 py-0.5 rounded text-foreground">
              npm run dev
            </code>
            ).
          </p>
        </div>
      </body>
    </html>
  );
}
