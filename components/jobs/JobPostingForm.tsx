"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import AgentHandoff from "@/components/agent/AgentHandoff";
import LocationSearchSelect from "@/components/LocationSearchSelect";
import StickyActionBar from "@/components/StickyActionBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { upsertJobPostingAction } from "@/app/actions/upsert-job-posting";
import { useEntitlementError } from "@/hooks/useEntitlementError";
import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { jobPostHandoffPrompt } from "@/helpers/agent/handoff-prompts";
import { applyQuestionSet } from "@/helpers/jobs/question-sets";
import { applicationFormSchema, type ApplicationForm } from "@/helpers/jobs/application-form-schema";
import type { ICreateJobPostingFormData } from "@/utils/types";
import ApplicationFormBuilder from "./ApplicationFormBuilder";
import QuestionSetPicker from "./QuestionSetPicker";

const jobFormSchema = z
  .object({
    title: z.string().min(2, {
      message: "Job title must be at least 2 characters.",
    }),
    description: z.string().min(20, {
      message: "Job description must be at least 20 characters.",
    }),
    location: z.array(z.string()).min(1, {
      message:
        "Please select at least one location or select the remote option.",
    }),
    job_type: z.enum(["Fulltime", "Intern", "Contract"], {
      required_error: "Please select a job type.",
    }),
    salary_currency: z.string(),
    min_salary: z.coerce
      .number()
      .min(0, { message: "Must be a positive number." }),
    max_salary: z.coerce.number().min(0, {
      message: "Must be a positive number.",
    }),
    min_experience: z.coerce
      .number()
      .min(0, { message: "Must be a positive number." }),
    max_experience: z.coerce
      .number()
      .min(0, { message: "Must be a positive number." })
      .optional(),
    visa_sponsorship: z.enum(["Required", "Not Required", "Will Sponsor"], {
      required_error: "Please select a visa option.",
    }),
    min_equity: z.coerce.number().min(0).max(100).optional(),
    max_equity: z.coerce.number().min(0).max(100).optional(),
    // CP-REQ-020: careers page filters.
    department: z.string().trim().max(60, "Departments can be at most 60 characters.").optional(),
    workplace_type: z.enum(["onsite", "hybrid", "remote"]).nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.min_salary && data.max_salary) {
        return data.max_salary >= data.min_salary;
      }
      return true;
    },
    {
      message: "Max salary must be greater than or equal to min salary.",
      path: ["max_salary"],
    },
  )
  .refine(
    (data) => {
      if (data.min_experience && data.max_experience) {
        return data.max_experience >= data.min_experience;
      }
      return true;
    },
    {
      message:
        "Max experience must be greater than or equal to min experience.",
      path: ["max_experience"],
    },
  )
  .refine(
    (data) => {
      if (data.min_equity && data.max_equity) {
        return data.max_equity >= data.min_equity;
      }
      return true;
    },
    {
      message: "Max equity must be greater than or equal to min equity.",
      path: ["max_equity"],
    },
  );

const jobTypes = ["Fulltime", "Intern", "Contract"];
const salaryCurrencies = ["₹", "$", "€", "£", "C$", "A$"];
const visaOptions = ["Will Sponsor", "Not Required", "Required"];
const workplaceOptions = [
  { value: "onsite", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
] as const;

/**
 * The job post form, on its own page (/company/job-posts/new and a job's Edit
 * section): the details, then the typed application form (AF-REQ-001). An
 * edit gets the full form, with its knockout rules, and the questions that
 * already have answers, loaded on the server (AF-REQ-005).
 */
export default function JobPostingForm({
  companyId,
  existingValues,
  initialForm,
  answeredQuestionIds = [],
  cancelHref,
}: {
  companyId: string;
  existingValues?: ICreateJobPostingFormData;
  initialForm: ApplicationForm;
  answeredQuestionIds?: string[];
  /** Where Cancel goes: the job list for a new post, the job for an edit. */
  cancelHref: string;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { handle: handleEntitlement, dialog: upgradeDialog } = useEntitlementError();
  const form = useForm({
    resolver: zodResolver(jobFormSchema),
    defaultValues: existingValues || {
      title: "",
      description: "",
      location: [],
      job_type: undefined,
      salary_currency: "$",
      min_salary: 0,
      max_salary: 0,
      min_experience: 0,
      max_experience: 0,
      visa_sponsorship: "Not Required",
      min_equity: 0,
      max_equity: 0,
      department: "",
      workplace_type: null,
    },
  });
  const [applicationForm, setApplicationForm] = useState<ApplicationForm>(initialForm);

  const onSubmit = async (values: ICreateJobPostingFormData) => {
    const checkedForm = applicationFormSchema.safeParse(applicationForm);
    if (!checkedForm.success) {
      toast.error(checkedForm.error.issues[0]?.message ?? "Check the application questions.");
      return;
    }
    setLoading(true);

    try {
      // The form replaces the old questions list (AF-CON-001: the server rebuilds it).
      const fields = { ...values };
      delete fields.id;
      delete fields.questions;
      const result = await upsertJobPostingAction({
        values: { ...fields, application_form: checkedForm.data },
        existingPostingId: existingValues?.id,
      });

      if (!result.success) {
        // At the plan's limit: the upgrade dialog explains it.
        if (await handleEntitlement(result)) return;
        throw new Error(typeof result.error === "string" ? result.error : "Failed to save job posting");
      }

      await mutate(`company-jobs-${companyId}`);
      toast.success(`Job Posting ${result.isUpdate ? "updated" : "created"} Successfully!`, { duration: 8000 });
      router.push(`/company/job-posts/${result.postingId}`);
      router.refresh();
    } catch (e) {
      const errMsg =
        e instanceof Error
          ? e.message
          : `An error occurred while ${existingValues ? "updating" : "creating"} the job posting. Please try again.`;
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form {...form}>
      {upgradeDialog}
      <AgentHandoff
        label={existingValues ? "Or tell the agent what to change" : "Or describe the job and let the agent write it"}
        placeholder={
          existingValues
            ? "Raise the salary range and make it remote…"
            : "Senior backend engineer, Go, remote in India, 30-45 LPA…"
        }
        basePath={COMPANY_AGENT_PATH}
        toPrompt={(text) =>
          jobPostHandoffPrompt(
            text,
            existingValues?.id ? { id: existingValues.id, title: existingValues.title } : undefined,
          )
        }
      />
      <form id="JobPostingForm" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>What the role is, where it is and what it pays.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Job Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Software Engineer" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Job Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Write a detailed job description..."
                      className="resize-y h-[200px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Locations</FormLabel>
                  <FormControl>
                    <LocationSearchSelect
                      name={field.name}
                      initialLocations={field.value ?? []}
                      onChange={(name, selectedLocations) =>
                        field.onChange(selectedLocations)
                      }
                      placeholder="Select preferred locations"
                      isSingleSelect={false}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="job_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Job Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a job type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {jobTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="visa_sponsorship"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Visa Sponsorship</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an option" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {visaOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Engineering" maxLength={60} {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="workplace_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Workplace (optional)</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                      defaultValue={field.value ?? "none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Not set" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Not set</SelectItem>
                        {workplaceOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="salary_currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="USD" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {salaryCurrencies.map((currency) => (
                          <SelectItem key={currency} value={currency}>
                            {currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="min_salary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min Salary(pa)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="80000"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value
                              ? parseFloat(e.target.value)
                              : undefined,
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="max_salary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Salary(pa)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="120000"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value
                              ? parseFloat(e.target.value)
                              : undefined,
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="min_experience"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min Experience (Years)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="2"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value
                              ? parseInt(e.target.value)
                              : undefined,
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="max_experience"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Experience (Years)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="5"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value
                              ? parseInt(e.target.value)
                              : undefined,
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="min_equity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min Equity (%)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="0.1"
                        step="0.01"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value
                              ? parseFloat(e.target.value)
                              : undefined,
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="max_equity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Equity (%)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="0.5"
                        step="0.01"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value
                              ? parseFloat(e.target.value)
                              : undefined,
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Application form</CardTitle>
            <CardDescription>The questions applicants answer when they apply.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <QuestionSetPicker
              disabled={loading}
              onApply={(copy) => setApplicationForm(applyQuestionSet(applicationForm, copy, answeredQuestionIds))}
            />
            <ApplicationFormBuilder
              value={applicationForm}
              onChange={setApplicationForm}
              answeredQuestionIds={answeredQuestionIds}
              disabled={loading}
            />
          </CardContent>
        </Card>

        <StickyActionBar className="justify-end">
          <Button type="button" variant="outline" disabled={loading} onClick={() => router.push(cancelHref)}>
            Cancel
          </Button>
          <Button type="submit" variant="brand" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {existingValues ? "Updating..." : "Posting..."}
              </>
            ) : existingValues ? (
              "Update Job"
            ) : (
              "Post Job"
            )}
          </Button>
        </StickyActionBar>
      </form>
    </Form>
  );
}
