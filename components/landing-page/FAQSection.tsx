"use client";

import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";

const FAQs = {
  "job-search": [
    {
      question: "What is the GetHired agent?",
      answer:
        "An AI assistant you chat with. It searches jobs, finds roles matched to your resume, tracks your applications, starts resume reviews and sets up mock interviews. It asks before changing your profile, and AI features use credits as shown in your account.",
    },
    {
      question: "How can I find relevant tech jobs on GetHired?",
      answer:
        "Search current developer and tech openings, then narrow results by job title, location, job type, salary, and experience.",
    },
    {
      question: "How does AI help with my job search?",
      answer:
        "GetHired uses profile and job details to provide personalized job recommendations in addition to standard keyword-based search.",
    },
    {
      question: "Can I apply to jobs from different companies?",
      answer:
        "Yes. GetHired brings together listings from company career sites and hiring platforms. Application steps depend on the individual listing.",
    },
    {
      question: "Is GetHired free for job seekers?",
      answer:
        "GetHired offers free features for job seekers. Some AI features may use credits, as shown in your account.",
    },
  ],
  hiring: [
    {
      question: "How can a company post a job on GetHired?",
      answer:
        "Create a company account, complete company onboarding, and use the company dashboard to create and manage job postings.",
    },
    {
      question: "How does GetHired help employers review applicants?",
      answer:
        "Employers can manage their job postings and applicants from the company dashboard, with AI features available to support candidate review.",
    },
    {
      question: "Can job seekers and employers both use GetHired?",
      answer:
        "Yes. Job seekers can search roles and manage applications, while employers can post openings and review applicants.",
    },
  ],
  "ai-interview": [
    {
      question: "What is GetHired's AI interview practice?",
      answer:
        "It provides AI-powered interview practice sessions to help you prepare for upcoming job interviews.",
    },
    {
      question: "Do I get feedback after an AI interview practice session?",
      answer:
        "GetHired provides personalized feedback so you can identify areas to improve before a real interview.",
    },
    {
      question: "Who can use interview practice?",
      answer:
        "Job seekers preparing for interviews can use GetHired's AI interview feature as part of their job search.",
    },
  ],
  resume: [
    {
      question: "What does the AI resume checker review?",
      answer:
        "GetHired analyzes your resume and provides feedback to help you improve how it presents your experience for a target role.",
    },
    {
      question: "Can I check my resume against a job description?",
      answer:
        "GetHired includes tools to compare a resume with job requirements and identify relevant areas to improve.",
    },
    {
      question: "Does a resume checker guarantee an interview?",
      answer:
        "No. Resume feedback can help you improve your materials, but hiring decisions are made by employers and no interview outcome is guaranteed.",
    },
  ],
  remote: [
    {
      question: "How do I find remote jobs on GetHired?",
      answer:
        "Search the job listings and use the location filter to find remote roles and opportunities in your preferred location.",
    },
    {
      question: "Can I filter jobs by location and job type?",
      answer:
        "Yes. The job search includes filters for location and job type, along with other criteria such as salary and experience.",
    },
    {
      question: "Where do I apply for a remote job?",
      answer:
        "Open a job listing to review its requirements and application instructions. Some employers accept applications on their own career sites.",
    },
  ],
  extension: [
    {
      question: "What does the GetHired Chrome Extension do?",
      answer:
        "It fills in job application forms for you on company career sites and hiring platforms, using the details from your GetHired profile and primary resume.",
    },
    {
      question: "Can it answer open-ended application questions?",
      answer:
        "Yes. For questions like \"Why do you want to work here?\", it writes a plain-text answer in your voice, based on your resume, your profile and the job you're applying to. It only uses facts from your background and won't invent links or details.",
    },
    {
      question: "Do I need a GetHired account to use it?",
      answer:
        "Yes. Sign in with your GetHired account so the extension can use your profile and primary resume. Set the resume you want to use as primary in your dashboard.",
    },
    {
      question: "Does the extension use AI credits?",
      answer:
        "Filling in standard fields doesn't. Each AI-written answer to an application question uses credits, as shown in your account. If you run out, you can buy more from your dashboard.",
    },
    {
      question: "Does it submit applications for me?",
      answer:
        "No. The extension fills in the form, and you review the answers and submit the application yourself.",
    },
  ],
  mcp: [
    {
      question: "What does the GetHired MCP Server do?",
      answer:
        "The GetHired MCP Server connects compatible AI assistants to job-search features, including personalized recommendations and resume tools.",
    },
    {
      question: "Which AI assistant can connect to the MCP Server?",
      answer:
        "GetHired's MCP Server is designed to integrate with Claude. Check the setup instructions for current compatibility and configuration.",
    },
    {
      question: "Can an AI assistant apply to jobs for me?",
      answer:
        "The MCP Server supports job-search assistance. Review each job's application process and submit applications through the employer's specified channel.",
    },
  ],
} as const;

type FAQTopic = keyof typeof FAQs;

export default function FAQSection({
  topic = "job-search",
}: {
  topic?: FAQTopic;
}) {
  const faqs = FAQs[topic];

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
