import AppLoader from "@/components/AppLoader";
import { LoginForm } from "@/components/login-form";
import { Metadata } from "next";
import { Suspense } from "react";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const { company } = await searchParams;

  if (company && company === "true") {
    return {
      title: "Recruiter Login | Access Your Recruiting Dashboard",
      description:
        "Recruiter login for GetHired. Access your hiring dashboard, manage job postings, and review candidates sourced by your AI agent.",
      keywords: [
        "recruiter login",
        "hiring manager sign in",
        "company dashboard",
        "recruitment platform access",
      ],
      alternates: {
        canonical: "https://gethired.devhub.co.in/auth/login?company=true",
      },
    };
  }

  return {
    title: "Applicant Login | Access Your Job Applications & Dashboard",
    description:
      "Log in to your GetHired account to track job applications, manage your profile, and see your top AI-matched job opportunities.",
    keywords: [
      "job seeker login",
      "applicant sign in",
      "track job applications",
      "job search dashboard",
    ],
    alternates: {
      canonical: "https://gethired.devhub.co.in/auth/login",
    },
  };
}

export default async function Page() {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Suspense fallback={<AppLoader color="secondary" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
