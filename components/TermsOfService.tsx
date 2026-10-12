import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function TermsOfService() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl sm:text-[28px] font-semibold tracking-tight text-center mb-2">
            Terms of Service
          </CardTitle>
          <CardDescription className="text-center">
            Last updated: July 30, 2025
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-[15px] leading-7">
          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing and using GetHired (the &quot;Service&quot;), you
              accept and agree to be bound by the terms and conditions of this
              agreement (&quot;Terms of Service&quot;). If you do not agree to
              abide by the above, please do not use this Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">
              2. Description of Service
            </h2>
            <p>
              GetHired provides [brief description of what your service does,
              e.g., &quot;a platform for users to create and share
              content,&quot; or &quot;e-commerce services for products&quot;].
              You understand and agree that the Service may include
              advertisements and that these advertisements are necessary for
              GetHired to provide the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">
              3. User Conduct
            </h2>
            <p>
              You agree to use the Service only for lawful purposes. You are
              prohibited from any conduct that restricts or inhibits any other
              user from using or enjoying the Service. Prohibited conduct
              includes, but is not limited to:
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1 mt-2">
              <li>
                Engaging in any illegal activity or soliciting any illegal
                activity.
              </li>
              <li>
                Impersonating any person or entity, or falsely stating or
                otherwise misrepresenting your affiliation with a person or
                entity.
              </li>
              <li>Distributing viruses or any other harmful computer code.</li>
              <li>
                Collecting or storing personal data about other users without
                their express consent.
              </li>
              <li>
                Interfering with or disrupting the Service or servers or
                networks connected to the Service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">
              4. Intellectual Property Rights
            </h2>
            <p>
              The Service and all materials therein, including, without
              limitation, software, images, text, graphics, illustrations,
              logos, patents, trademarks, service marks, copyrights,
              photographs, audio, videos, music, and &quot;look and feel&quot;
              of the Service, and all Intellectual Property Rights related
              thereto, are the exclusive property of [Your Company Name] and its
              licensors. Except as explicitly provided herein, nothing in these
              Terms of Service shall be deemed to create a license in or under
              any such Intellectual Property Rights, and you agree not to sell,
              license, rent, modify, distribute, copy, reproduce, transmit,
              publicly display, publicly perform, publish, adapt, edit or create
              derivative works from any materials or content accessible on the
              Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">
              5. Disclaimer of Warranties
            </h2>
            <p>
              THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS
              AVAILABLE&quot; BASIS. [YOUR WEBSITE/APP NAME] EXPRESSLY DISCLAIMS
              ALL WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING,
              BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY,
              FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">
              6. Limitation of Liability
            </h2>
            <p>
              YOU EXPRESSLY UNDERSTAND AND AGREE THAT [YOUR WEBSITE/APP NAME]
              SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
              CONSEQUENTIAL OR EXEMPLARY DAMAGES, INCLUDING BUT NOT LIMITED TO,
              DAMAGES FOR LOSS OF PROFITS, GOODWILL, USE, DATA OR OTHER
              INTANGIBLE LOSSES (EVEN IF [YOUR WEBSITE/APP NAME] HAS BEEN
              ADVISED OF THE POSSIBILITY OF SUCH DAMAGES), RESULTING FROM: (I)
              THE USE OR THE INABILITY TO USE THE SERVICE; (II) THE COST OF
              PROCUREMENT OF SUBSTITUTE GOODS AND SERVICES RESULTING FROM ANY
              GOODS, DATA, INFORMATION OR SERVICES PURCHASED OR OBTAINED OR
              MESSAGES RECEIVED OR TRANSACTIONS ENTERED INTO THROUGH OR FROM THE
              SERVICE; (III) UNAUTHORIZED ACCESS TO OR ALTERATION OF YOUR
              TRANSMISSIONS OR DATA; (IV) STATEMENTS OR CONDUCT OF ANY THIRD
              PARTY ON THE SERVICE; OR (V) ANY OTHER MATTER RELATING TO THE
              SERVICE.
            </p>
          </section>

          {/* Add more sections as needed, e.g.,
          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">7. Indemnification</h2>
            <p>You agree to indemnify and hold GetHired, its subsidiaries, affiliates, officers, agents, employees, partners and licensors harmless from any claim or demand, including reasonable attorneys' fees, made by any third party due to or arising out of Content you submit, post, transmit or otherwise make available through the Service, your use of the Service, your connection to the Service, your violation of the Terms of Service, or your violation of any rights of another.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">8. Modifications to Service</h2>
            <p>GetHired reserves the right at any time and from time to time to modify or discontinue, temporarily or permanently, the Service (or any part thereof) with or without notice.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">9. Governing Law</h2>
            <p>These Terms of Service shall be governed by and construed in accordance with the laws of [Your State/Country], without regard to its conflict of law principles.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">10. Severability</h2>
            <p>If any provision of these Terms of Service is found to be invalid or unenforceable by a court of competent jurisdiction, the invalidity or unenforceability of such provision shall not affect the validity or enforceability of the remaining provisions of these Terms of Service, which shall remain in full force and effect.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">11. Contact Information</h2>
            <p>Questions about the Terms of Service should be sent to us at [Your Contact Email/Method].</p>
          </section>
          */}
        </CardContent>
      </Card>
    </div>
  );
}
