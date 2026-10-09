import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";

export default function ContactComponent() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center mb-2">
            Contact
          </CardTitle>
          <CardDescription className="text-center text-gray-600">
            Last updated: October 9, 2026
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-lg leading-relaxed">
          <section>
            <p>
              Hi, I&apos;m{" "}
              <Link
                className="underline text-blue-600"
                href={"https://varun.devhub.co.in"}
                target="_blank"
              >
                Varun
              </Link>
              . I&apos;m the founder of GetHired, a platform dedicated to
              helping job seekers find their dream jobs. With a passion for
              technology and a deep understanding of the job market, I created
              GetHired to provide users with the tools and resources they need
              to succeed in their careers.
            </p>
            <p>You can contact me here on my email: varun@devhub.co.in</p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
