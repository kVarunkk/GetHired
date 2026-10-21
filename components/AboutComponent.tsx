import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import {
  ABOUT_PARAGRAPHS,
  ABOUT_UPDATED,
  FOUNDER,
  FOUNDER_INTRO,
} from "@/helpers/marketing/content";

export default function AboutComponent() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl sm:text-[28px] font-semibold tracking-tight text-center mb-2">
            About Us
          </CardTitle>
          <CardDescription className="text-center">
            Last updated: {ABOUT_UPDATED}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-[15px] leading-7">
          <section>
            <p>
              Hi, I&apos;m{" "}
              <Link
                className="font-medium underline underline-offset-4 transition-colors hover:text-brand"
                href={FOUNDER.url}
                target="_blank"
              >
                {FOUNDER.name}
              </Link>
              . {FOUNDER_INTRO}
            </p>
            {ABOUT_PARAGRAPHS.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
