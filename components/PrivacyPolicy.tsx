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
          <CardTitle className="text-2xl sm:text-[28px] font-semibold tracking-tight text-center mb-2">
            Privacy Policy
          </CardTitle>
          <CardDescription className="text-center">
            Last updated: November 14, 2026
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-[15px] leading-7">
          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">
              1. Introduction
            </h2>
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
            <h2 className="text-lg font-semibold tracking-tight mb-3">
              2. What Information Do We Collect?
            </h2>
            <h3 className="text-base font-medium mb-2">
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
            <p className="mt-2">
              If you rate or comment on the agent&apos;s replies, we store your
              ratings and comments with that chat, and they are deleted when
              you delete the chat.
            </p>

            <h3 className="text-base font-medium mb-2 mt-4">
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
            <h2 className="text-lg font-semibold tracking-tight mb-3">
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

          <section aria-labelledby="google-calendar">
            <h2 id="google-calendar" className="text-lg font-semibold tracking-tight mb-3">
              4. Google Calendar
            </h2>
            <p>
              Company members can connect a Google Calendar to schedule interviews from GetHired. Connecting is
              optional, and this section describes what happens when a member does.
            </p>
            <h3 className="text-base font-medium mb-2 mt-4">What we access</h3>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>The email address of the connected Google account.</li>
              <li>
                Free/busy times: only when you are busy, as blocks of time. We never read the titles, descriptions,
                attendees or other details of your events.
              </li>
              <li>
                The interview events GetHired creates on your calendar: their time, title, attendees and Google Meet
                link.
              </li>
            </ul>
            <h3 className="text-base font-medium mb-2 mt-4">How we use it</h3>
            <p>
              Only to show when you are available and to create, move and cancel the interviews that you, your
              teammates or a candidate book in GetHired. We check those events for changes made in Google Calendar,
              such as a new time, a cancellation or an interviewer&apos;s reply.
            </p>
            <h3 className="text-base font-medium mb-2 mt-4">Sharing</h3>
            <p>
              An interview event is shared with its attendees through Google: the interviewers and, where they can be
              invited, the candidate. The candidate can see the organizer&apos;s email address. We do not sell
              information from Google, use it for advertising, or use it to train AI models.
            </p>
            <h3 className="text-base font-medium mb-2 mt-4">Candidates</h3>
            <p>
              When an interview is booked, the candidate&apos;s name and email address are added as an attendee of the
              interview event, so Google sends them the invitation. A candidate a company added without an email
              address, or who unsubscribed from that company&apos;s emails, is not added.
            </p>
            <h3 className="text-base font-medium mb-2 mt-4">Storage</h3>
            <p>
              The access tokens Google gives us are encrypted at rest (AES-256-GCM, with the key kept outside the
              database) and are used only by GetHired&apos;s servers.
            </p>
            <h3 className="text-base font-medium mb-2 mt-4">Retention and deletion</h3>
            <p>
              Disconnecting your calendar, leaving your company on GetHired or deleting your account revokes our
              access at Google and deletes the tokens. You can also remove GetHired&apos;s access at any time from the{" "}
              <a
                href="https://myaccount.google.com/connections"
                className="underline underline-offset-4"
                target="_blank"
                rel="noopener noreferrer"
              >
                third-party access page
              </a>{" "}
              of your Google Account.
            </p>
            <p className="mt-4">
              GetHired&apos;s use and transfer to any other app of information received from Google APIs will adhere
              to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="underline underline-offset-4"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
