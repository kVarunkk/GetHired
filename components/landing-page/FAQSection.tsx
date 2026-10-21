"use client";

import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { FAQS, type FAQTopic } from "@/helpers/marketing/content";

export default function FAQSection({
  topic = "job-search",
}: {
  topic?: FAQTopic;
}) {
  const faqs = FAQS[topic];

  return (
    <section id="faq" className="px-4 py-3 lg:px-20 xl:px-40 2xl:px-80 ">
      <div className="container mx-auto max-w-4xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Find quick answers to the most common questions about GetHired.
          </p>
        </div>

        <Accordion type="single" collapsible className="w-full">
          {faqs.map((faq, index) => (
            <AccordionItem value={`item-${index}`} key={index}>
              <AccordionTrigger className="text-left">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
