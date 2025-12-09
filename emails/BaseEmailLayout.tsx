import {
  Body,
  Container,
  Head,
  Html,
  Text,
  Section,
  Img,
  Link,
  Tailwind,
  Row,
  Column,
} from "@react-email/components";
import * as React from "react";

interface BaseEmailLayoutProps {
  previewText: string;
  children: React.ReactNode;
}

export const BaseEmailLayout = ({
  previewText,
  children,
}: BaseEmailLayoutProps) => {
  const containerPadding = "2.5rem";

  return (
    <Html>
      <Head></Head>
      <Text>{previewText}</Text>
      <Tailwind>
        <Body className="bg-gray-50 font-sans text-gray-800 main-body-bg">
          <Container className="mx-auto my-0 max-w-[600px] bg-white border border-gray-200 rounded-lg shadow-lg content-container-bg">
            <Section className="p-10" style={{ padding: containerPadding }}>
              <Row>
                <Column className="w-full">
                  <Link href="https://gethired.devhub.co.in">
                    <Img
                      src="https://gethired.devhub.co.in/logos/short-light.png"
                      width="50"
                      alt="GetHired"
                      className="max-w-[50px]"
                    />
                  </Link>
                </Column>
                <Column align="right">
                  <Row align="right">
                    <Column className="px-[8px]">
                      <Link
                        className="text-gray-800  [text-decoration:none]"
                        href="https://gethired.devhub.co.in/jobs"
                      >
                        Jobs
                      </Link>
                    </Column>
                    <Column className="px-[8px]">
                      <Link
                        className="text-gray-800  [text-decoration:none]"
                        href="https://gethired.devhub.co.in/hire"
                      >
                        Hire
                      </Link>
                    </Column>
                  </Row>
                </Column>
              </Row>

              <Section className="py-4 text-color">{children}</Section>

              <Section className="mt-8 pt-6 border-t border-gray-200 text-center border-color">
                <Text className="text-xs text-gray-500 mb-2">
                  &copy; {new Date().getFullYear()} GetHired DevHub. All rights
                  reserved.
                </Text>
                <Text className="text-xs text-gray-500 mb-2">
                  <Link
                    href="https://gethired.devhub.co.in/privacy-policy"
                    className="text-blue-600 underline"
                  >
                    Privacy Policy
                  </Link>
                  {" | "}
                  <Link
                    href="https://gethired.devhub.co.in/terms-of-service"
                    className="text-blue-600 underline"
                  >
                    Terms of Service
                  </Link>
                </Text>
                <Text className="text-xs text-gray-500">
                  To no longer receive these, manage your preferences{" "}
                  <Link
                    href="https://gethired.devhub.co.in/get-started?edit=true"
                    className="text-blue-600 underline"
                  >
                    here
                  </Link>
                </Text>
              </Section>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};
