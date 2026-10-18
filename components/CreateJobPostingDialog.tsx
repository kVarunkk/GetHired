"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import AgentHandoff from "@/components/agent/AgentHandoff";
import { Button } from "@/components/ui/button";
import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { jobPostHandoffPrompt } from "@/helpers/agent/handoff-prompts";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Pencil, PlusCircle } from "lucide-react";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { ICreateJobPostingFormData } from "@/utils/types";
import { upsertJobPostingAction } from "@/app/actions/upsert-job-posting";
import { useEntitlementError } from "@/hooks/useEntitlementError";
import { mutate } from "swr";
import LocationSearchSelect from "./LocationSearchSelect";
import RoleLocked from "./team/RoleLocked";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import ApplicationFormBuilder from "./jobs/ApplicationFormBuilder";
import QuestionSetPicker from "./jobs/QuestionSetPicker";
import { applyQuestionSet } from "@/helpers/jobs/question-sets";
import { loadJobFormAction } from "@/app/actions/jobs/load-job-form";
import {
  applicationFormSchema,
  formFromLegacyQuestions,
  readApplicationForm,
  type ApplicationForm,
} from "@/helpers/jobs/application-form-schema";

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

export default function CreateJobPostingDialog({
  companyId,
  existingValues,
  disabled = false,
}: {
  companyId: string;
  existingValues?: ICreateJobPostingFormData;
  /** For members, who can't create or edit jobs (TM-REQ-004). */
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1);

  const router = useRouter();
  const { handle: handleEntitlement, dialog: upgradeDialog } =
    useEntitlementError();
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

  // AF-REQ-001: the typed form, edited on step 2. An edit loads the full form
  // (with its knockout rules) and the questions that already have answers.
  const [applicationForm, setApplicationForm] = useState<ApplicationForm>(() =>
    existingValues
      ? readApplicationForm(existingValues.application_form, existingValues.questions)
      : formFromLegacyQuestions([]),
  );
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<string[]>([]);
  const [formLoaded, setFormLoaded] = useState(!existingValues?.id);
  const existingId = existingValues?.id;
  useEffect(() => {
    if (!isOpen || formLoaded || !existingId) return;
    let cancelled = false;
    void loadJobFormAction({ jobPostId: existingId }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setApplicationForm(result.form);
        setAnsweredQuestionIds(result.answeredQuestionIds);
      } else {
        toast.error(result.error);
      }
      setFormLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, formLoaded, existingId]);

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
        if (await handleEntitlement(result)) {
          setIsOpen(false);
          return;
        }
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "Failed to save job posting",
        );
      }

      await mutate(`company-jobs-${companyId}`);

      toast.success(
        `Job Posting ${result.isUpdate ? "updated" : "created"} Successfully!`,
        { duration: 8000 },
      );

      if (typeof form !== "undefined" && form.reset) {
        form.reset();
      }
      setIsOpen(false);
      router.refresh();
    } catch (e) {
      const errMsg =
        e instanceof Error
          ? e.message
          : `An error occurred while ${
              existingValues ? "updating" : "creating"
            } the job posting. Please try again.`;
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleNextStep = async () => {
    const isValid = await form.trigger([
      "title",
      "description",
      "location",
      "job_type",
      "salary_currency",
      "min_salary",
      "max_salary",
      "min_experience",
      "max_experience",
      "visa_sponsorship",
      "min_equity",
      "max_equity",
    ]);

    if (isValid) {
      setStep(2);
    }
  };

  const jobTypes = ["Fulltime", "Intern", "Contract"];
  const salaryCurrencies = ["₹", "$", "€", "£", "C$", "A$"];
  const visaOptions = ["Will Sponsor", "Not Required", "Required"];
  const workplaceOptions = [
    { value: "onsite", label: "On-site" },
    { value: "hybrid", label: "Hybrid" },
    { value: "remote", label: "Remote" },
  ] as const;

  const trigger = existingValues ? (
    <Button
      variant={"ghost"}
      className="text-muted-foreground"
      aria-label="Edit Job Post"
      disabled={disabled}
    >
      <Pencil className=" h-4 w-4" />
    </Button>
  ) : (
    <Button variant="brand" className="max-w-full" disabled={disabled}>
      <PlusCircle />
      <span>Create New Job Post</span>
    </Button>
  );

  if (disabled) {
    return (
      <RoleLocked reason={forbiddenMessage(existingValues ? "jobs.edit" : "jobs.create")}>{trigger}</RoleLocked>
    );
  }

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      {/* Its own dialog, portalled; it stays mounted when this one closes. */}
      {upgradeDialog}
      <ResponsiveDialogTrigger
        title={existingValues ? "Edit Job Post" : "Create Job Post"}
        asChild
      >
        {trigger}
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent
        className="h-[85vh] max-w-xl"
        drawerClassName="h-[85dvh]"
      >
        <ResponsiveDialogHeader className="h-fit">
          <ResponsiveDialogTitle>
            {existingValues
              ? `Update ${existingValues.title} job post`
              : "Create New Job Post"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {existingValues
              ? `Fill in the details for ${existingValues.title} job opening`
              : "Fill in the details for your new job opening."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <ResponsiveDialogBody>
            {step === 1 && (
              <div className="mb-4">
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
                  onHandoff={() => setIsOpen(false)}
                />
              </div>
            )}
            <form
              id="JobPostingForm"
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
            >
              {step === 1 ? (
                <>
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
                </>
              ) : (
                formLoaded ? (
                  <div className="flex flex-col gap-4">
                    <QuestionSetPicker
                      disabled={loading}
                      onApply={(copy) =>
                        setApplicationForm(applyQuestionSet(applicationForm, copy, answeredQuestionIds))
                      }
                    />
                    <ApplicationFormBuilder
                      value={applicationForm}
                      onChange={setApplicationForm}
                      answeredQuestionIds={answeredQuestionIds}
                      disabled={loading}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading the application form…
                  </div>
                )
              )}
            </form>
          </ResponsiveDialogBody>

          <ResponsiveDialogFooter>
            {step === 2 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
              >
                Back
              </Button>
            )}
            {step === 1 && (
              <Button type="button" variant="brand" onClick={handleNextStep}>
                Next
              </Button>
            )}
            {step === 2 && (
              <Button
                form="JobPostingForm"
                type="submit"
                variant="brand"
                disabled={loading || !formLoaded}
              >
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
            )}
          </ResponsiveDialogFooter>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
