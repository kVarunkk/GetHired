import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function PrivacyPolicy() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center mb-2">
            Privacy Policy
          </CardTitle>
          <CardDescription className="text-center text-gray-600">
            Last updated: July 30, 2025
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-lg leading-relaxed">
          <section>
            <h2 className="text-2xl font-semibold mb-3">1. Introduction</h2>
            <p>
              Welcome to GetHired&apos;s Privacy Policy. We are committed to
              protecting your personal data and your right to privacy. If you
              have any questions or concerns about our policy, or our practices
              with regards to your personal information, please contact us at
              varun@devhub.co.in
            </p>
            <p>
              This Privacy Policy applies to all information collected through
              our website, application, and/or any related services, sales,
              marketing or events (we refer to them collectively in this privacy
              policy as the &quot;Services&quot;).
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">
              2. What Information Do We Collect?
            </h2>
            <h3 className="text-xl font-medium mb-2">
              Personal Information You Disclose to Us
            </h3>
            <p>
              We collect personal information that you voluntarily provide to us
              when you register on the Services, express an interest in
              obtaining information about us or our products and Services, when
              you participate in activities on the Services or otherwise when
              you contact us.
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1 mt-2">
              <li>Names</li>
              <li>Email addresses</li>
              <li>Phone numbers</li>
              <li>Usernames</li>
              <li>Passwords</li>
              <li>Billing addresses</li>
              <li>Payment information</li>
            </ul>
            <p className="mt-2">
              The personal information that we collect depends on the context of
              your interactions with us and the Services, the choices you make
              and the products and features you use.
            </p>

            <h3 className="text-xl font-medium mb-2 mt-4">
              Information Automatically Collected
            </h3>
            <p>
              We automatically collect certain information when you visit, use
              or navigate the Services. This information does not reveal your
              specific identity (like your name or contact information) but may
              include device and usage information, such as your IP address,
              browser and device characteristics, operating system, language
              preferences, referring URLs, device name, country, location,
              information about how and when you use our Services and other
              technical information.
            </p>
            <p>
              Like many businesses, we also collect information through cookies
              and similar technologies.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">
              3. How Do We Use Your Information?
            </h2>
            <p>
              We use personal information collected via our Services for a
              variety of business purposes described below. We process your
              personal information for these purposes in reliance on our
              legitimate business interests, in order to enter into or perform a
              contract with you, with your consent, and/or for compliance with
              our legal obligations. We indicate the specific processing grounds
              we rely on next to each purpose listed below.
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1 mt-2">
              <li>To facilitate account creation and logon process.</li>
              <li>To send you marketing and promotional communications.</li>
              <li>To send administrative information to you.</li>
              <li>To fulfill and manage your orders.</li>
              <li>To post testimonials.</li>
              <li>To deliver targeted advertising to you.</li>
              <li>To protect our Services.</li>
              <li>To respond to user inquiries/offer support to users.</li>
              <li>To enable user-to-user communications.</li>
              <li>To request feedback.</li>
              <li>To improve our Services.</li>
            </ul>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
