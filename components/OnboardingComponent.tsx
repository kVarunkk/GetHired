"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  startTransition,
} from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "./ui/alert";
import { Progress } from "./ui/progress";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { Step1JobRole } from "./onboarding-steps/Step1";
import { Step2LocationSalary } from "./onboarding-steps/Step2";
import { Step3SkillsExperience } from "./onboarding-steps/Step3";
import { Step4VisaWorkStyle } from "./onboarding-steps/Step4";
import { Step5CareerGoals } from "./onboarding-steps/Step5";
import { Step6ResumeUpload } from "./onboarding-steps/Step6";
import { Step7ReviewSubmit } from "./onboarding-steps/Step7";
import { isValidUrl } from "@/utils/utils";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import StickyActionBar from "./StickyActionBar";
import {
  agentPromptHref,
  ONBOARDING_PROMPT,
  PROFILE_UPDATE_PROMPT,
  savePendingPrompt,
} from "@/helpers/agent/prompt-draft";
import { submitOnboardingAction } from "@/app/actions/submit-onboarding";
import { useProgress } from "react-transition-progress";
import { APPLICANT_HOME } from "@/helpers/user/home-path";

type IFormData = {
  email: string | null;
  full_name: string;
  linkedin_url: string;
  github_url: string;
  desired_roles: string[];
  preferred_locations: string[];
  salary_currency: string;
  min_salary: number | "";
  max_salary: number | "";
  experience_years: number | "";
  industry_preferences: string[];
  visa_sponsorship_required: boolean;
  top_skills: string[];
  work_style_preferences: string[];
  career_goals_short_term: string;
  career_goals_long_term: string;
  company_size_preference: string;
  resume_file: File | null;
  resume_id: string | null;
  no_of_resumes?: number;
  job_type: string[];
  user_id?: string;
};

export interface StepProps {
  formData: IFormData;
  setFormData: React.Dispatch<React.SetStateAction<IFormData>>;
  errors: Partial<Record<keyof IFormData, string>>;
  setErrors: React.Dispatch<
    React.SetStateAction<Partial<Record<keyof IFormData, string>>>
  >;
}

export const OnboardingForm: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<IFormData>({
    full_name: "",
    linkedin_url: "",
    github_url: "",
    desired_roles: [],
    preferred_locations: [],
    salary_currency: "$",
    min_salary: "",
    max_salary: "",
    experience_years: "",
    industry_preferences: [],
    visa_sponsorship_required: false,
    top_skills: [],
    work_style_preferences: [],
    career_goals_short_term: "",
    career_goals_long_term: "",
    company_size_preference: "",
    resume_file: null,
    resume_id: null,
    job_type: [],
    email: "",
  });

  const [isLoading, setIsLoading] = useState(false);
  const [stepLoading, setStepLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<
    Partial<Record<keyof IFormData, string>>
  >({});
  const [user, setUser] = useState<User | null>(null);
  const startProgress = useProgress();
  const router = useRouter();

  const steps = useMemo(() => {
    return [
      {
        name: "Job Role",
        component: Step1JobRole,
        fields: [
          "full_name",
          "linkedin_url",
          "github_url",
          "desired_roles",
          "job_type",
        ],
      },
      {
        name: "Location & Salary",
        component: Step2LocationSalary,
        fields: [
          "preferred_locations",
          "min_salary",
          "max_salary",
          "salary_currency",
        ],
      },
      {
        name: "Experience & Skills",
        component: Step3SkillsExperience,
        fields: ["experience_years", "top_skills"],
      },
      {
        name: "Visa & Work Style",
        component: Step4VisaWorkStyle,
        fields: ["industry_preferences", "work_style_preferences"],
      },
      {
        name: "Career Goals",
        component: Step5CareerGoals,
        fields: [
          "career_goals_short_term",
          "career_goals_long_term",
          "company_size_preference",
        ],
      },
      {
        name: "Resume Upload",
        component: Step6ResumeUpload,
        fields: ["resume_file"],
      },
      { name: "Review", component: Step7ReviewSubmit, fields: [] },
    ];
  }, []);

  const totalSteps = steps.length;
  const progress = ((currentStep + 1) / totalSteps) * 100;

  useEffect(() => {
    const fetchUserAndData = async () => {
      setStepLoading(true);
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        const { data, error } = await supabase
          .from("user_info")
          .select("*, resumes(id, content, is_primary)")
          .eq("user_id", user.id)
          .single();

        if (data) {
          const primaryResume = data?.resumes?.find((_) => _.is_primary);
          const noOfResumes = data?.resumes?.length;

          setFormData((prev) => ({
            ...prev,
            full_name: data.full_name || "",
            linkedin_url: data.linkedin_url || "",
            github_url: data.github_url || "",
            desired_roles: data.desired_roles || [],
            preferred_locations: data.preferred_locations || [],
            salary_currency: data.salary_currency || "$",
            job_type: data.job_type || [],
            min_salary: data.min_salary || "",
            max_salary: data.max_salary || "",
            experience_years: data.experience_years || "",
            resume_id: primaryResume ? primaryResume.id : null,
            user_id: user.id,
            top_skills: data.top_skills || [],
            industry_preferences: data.industry_preferences || [],
            work_style_preferences: data.work_style_preferences || [],
            visa_sponsorship_required: data.visa_sponsorship_required ?? false,
            career_goals_short_term: data.career_goals_long_term || "",
            career_goals_long_term: data.career_goals_long_term || "",
            company_size_preference: data.company_size_preference || "",
            no_of_resumes: noOfResumes,
            resume_file: null,
          }));
        } else if (error && error.code !== "PGRST116") {
          setError(`Failed to load user data: ${error.message}`);
        }
      } else {
        setError("User not logged in. Please log in to complete onboarding.");
      }
      setStepLoading(false);
    };

    fetchUserAndData();
  }, []);

  const validateStep = useCallback(() => {
    const currentStepFields = steps[currentStep].fields;
    const newErrors: Partial<Record<keyof IFormData, string>> = {};
    let isValid = true;

    currentStepFields.forEach((field) => {
      const value = formData[field as keyof IFormData];

      switch (field) {
        case "full_name":
          if (!value || (value as string).trim() === "") {
            newErrors[field] = "Full name is required.";
            isValid = false;
          }
          break;
        case "linkedin_url":
        case "github_url":
          if (value && (value as string).trim() !== "") {
            if (!isValidUrl(value as string)) {
              newErrors[field] = "Please enter a valid URL.";
              isValid = false;
            }
          }
          break;
        case "desired_roles":
          if (((value as string[]) ?? []).length === 0) {
            newErrors[field] = "Please select atleast one role.";
            isValid = false;
          }
          break;
        case "job_type":
          if (((value as string[]) ?? []).length === 0) {
            newErrors[field] = "Please select atleast one type.";
            isValid = false;
          }
          break;
        case "salary_currency":
          if (!value) {
            newErrors[field] = "Please select a salary currency.";
            isValid = false;
          }
          break;
        case "preferred_locations":
          if (((value as string[]) ?? []).length === 0) {
            newErrors[field] = "Please select atleast one location.";
            isValid = false;
          }
          break;
        case "top_skills":
          if (((value as string[]) ?? []).length === 0) {
            newErrors[field] = "Please select atleast one skill.";
            isValid = false;
          }
          break;
        case "work_style_preferences":
          if (((value as string[]) ?? []).length === 0) {
            newErrors[field] = "This field is required.";
            isValid = false;
          }
          break;
        case "min_salary":
        case "experience_years":
          if (typeof value !== "number" || isNaN(value) || value < 0) {
            newErrors[field] = "Please enter a valid positive number.";
            isValid = false;
          }
          break;
        case "max_salary":
          if (
            value !== "" &&
            (typeof value !== "number" || isNaN(value) || value < 0)
          ) {
            newErrors[field] =
              "Please enter a valid positive number or leave empty.";
            isValid = false;
          } else if (
            typeof formData.min_salary === "number" &&
            typeof value === "number" &&
            value < formData.min_salary
          ) {
            newErrors[field] = "Max salary cannot be less than min salary.";
            isValid = false;
          }
          break;
        case "company_size_preference":
          if (!value) {
            newErrors[field] = "This field is required.";
            isValid = false;
          }
          break;
        case "resume_file":
          if (
            currentStep ===
              steps.findIndex((s) => s.name === "Resume Upload") &&
            !(formData.resume_id || formData.resume_file)
          ) {
            newErrors[field] = "Please upload your resume.";
            isValid = false;
          }
          break;
      }
    });

    setFormErrors(newErrors);
    return isValid;
  }, [formData, currentStep, steps]);

  const handleNext = async () => {
    setError(null);

    if (!validateStep()) {
      return;
    }

    if (currentStep < totalSteps - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    setError(null);
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setIsLoading(true);
    const toastId = toast.loading(
      "Finalizing your profile and finding matches...",
    );

    if (!user) {
      setError("User not authenticated. Please log in.");
      toast.error("Authentication required. Please log in.", { id: toastId });
      setIsLoading(false);
      return;
    }

    try {
      const dataToSave = {
        user_id: user.id,
        email: user.email,
        desired_roles: formData.desired_roles,
        full_name: formData.full_name,
        linkedin_url: formData.linkedin_url,
        github_url: formData.github_url,
        preferred_locations: formData.preferred_locations,
        salary_currency: formData.salary_currency || "$",
        min_salary: formData.min_salary === "" ? null : formData.min_salary,
        max_salary: formData.max_salary === "" ? null : formData.max_salary,
        experience_years:
          formData.experience_years === "" ? null : formData.experience_years,
        industry_preferences: formData.industry_preferences,
        visa_sponsorship_required: formData.visa_sponsorship_required,
        top_skills: formData.top_skills,
        work_style_preferences: formData.work_style_preferences,
        career_goals_short_term: formData.career_goals_short_term,
        career_goals_long_term: formData.career_goals_long_term,
        company_size_preference: formData.company_size_preference,
        job_type: formData.job_type,
        filled: true,
      };
      const onboardingFormData = new FormData();

      onboardingFormData.append("profileData", JSON.stringify(dataToSave));
      if (formData.resume_file) {
        onboardingFormData.append("resumeFile", formData.resume_file);
      } else if (formData.resume_id) {
        onboardingFormData.append("resumeId", formData.resume_id);
      }

      const result = await submitOnboardingAction(onboardingFormData);

      if (result.error) {
        throw new Error(result.error);
      }

      // submitOnboardingAction also marks onboarding complete on the server.
      toast.success("Profile complete! Welcome to GetHired.", { id: toastId });

      startTransition(() => {
        startProgress();
        router.push(APPLICANT_HOME);
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Something went wrong during submission.",
        { id: toastId },
      );
      setError(
        `An unexpected error occurred during submission: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      setIsLoading(false);
    }
  };

  const CurrentStepComponent = steps[currentStep].component;

  // Onboarded users get help improving the profile instead of setting it up.
  const isOnboarded = user?.app_metadata?.onboarding_complete === true;
  const agentPrompt = isOnboarded ? PROFILE_UPDATE_PROMPT : ONBOARDING_PROMPT;

  if (error && !user) {
    return (
      <div className="flex items-center justify-center min-h-screen ">
        <Card className="w-full max-w-md !shadow-none">
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>
              Please log in to access the onboarding form.
            </CardDescription>
          </CardHeader>
          <CardContent className="!p-0">
            <Alert>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-6 mb-20 p-4">
      <PageHeader
        title="Profile"
        description={
          <>
            Your roles, skills and resume. Visibility, outreach and email
            preferences are in{" "}
            <Link
              href="/settings"
              className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-brand"
            >
              Settings
            </Link>
            .
          </>
        }
      />
      <div className="flex flex-col gap-5 max-w-2xl w-full">
        <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {isOnboarded
              ? "Want a second opinion? The agent can review your profile and suggest improvements."
              : "Rather chat? The agent can set up your profile for you."}
          </p>
          <Button asChild variant="brand" className="shrink-0">
            <Link
              href={agentPromptHref(agentPrompt)}
              onClick={() => savePendingPrompt(agentPrompt)}
            >
              <Sparkles className="h-4 w-4" />
              {isOnboarded
                ? "Improve with the Agent"
                : "Complete with the Agent"}
            </Link>
          </Button>
        </div>
      </div>

      {stepLoading ? (
        <div className="h-20 w-full max-w-2xl flex items-center justify-center">
          <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
        </div>
      ) : (
        <Card className="flex w-full max-w-2xl flex-col gap-6 !border-none !p-0 shadow-none">
          <CardHeader className="!p-0">
            <Progress value={progress} className="mt-4" />
          </CardHeader>
          <CurrentStepComponent
            formData={formData}
            setFormData={setFormData}
            errors={formErrors}
            setErrors={setFormErrors}
            // loadingLocations={isLoadingLocations}
          />
          {/* In the sticky bar, so the error shows wherever Next was clicked. */}
          <StickyActionBar className="justify-between">
            {error && (
              <p
                role="alert"
                className="flex w-full items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            )}
            <Button
              variant={"outline"}
              onClick={handleBack}
              disabled={currentStep === 0 || isLoading}
            >
              Back
            </Button>
            <Button variant="brand" onClick={handleNext} disabled={isLoading}>
              {isLoading
                ? "Processing..."
                : currentStep === totalSteps - 1
                  ? "Submit"
                  : "Next"}
            </Button>
          </StickyActionBar>
          <p className="text-muted-foreground text-xs text-center">
            No need to panic, you can always update this information.
          </p>
        </Card>
      )}
    </div>
  );
};
