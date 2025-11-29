"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "./ui/alert";
import { Progress } from "./ui/progress";
import { IFormData } from "@/lib/types";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import UserOnboardingPersonalization from "./UserOnboardingPersonalization";
import { useCachedFetch } from "@/lib/hooks/useCachedFetch";
import { Step1JobRole } from "./onboarding-steps/Step1";
import { Step2LocationSalary } from "./onboarding-steps/Step2";
import { Step3SkillsExperience } from "./onboarding-steps/Step3";
import { Step4VisaWorkStyle } from "./onboarding-steps/Step4";
import { Step5CareerGoals } from "./onboarding-steps/Step5";
import { Step6ResumeUpload } from "./onboarding-steps/Step6";
import { Step7ReviewSubmit } from "./onboarding-steps/Step7";
import { isValidUrl } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface StepProps {
  formData: IFormData;
  setFormData: React.Dispatch<React.SetStateAction<IFormData>>;
  errors: Partial<Record<keyof IFormData, string>>;
  setErrors: React.Dispatch<
    React.SetStateAction<Partial<Record<keyof IFormData, string>>>
  >;
  loadingLocations?: boolean;
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
    resume_url: null,
    resume_path: null,
    resume_name: null,
    default_locations: [],
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
  const [initialPreferencesState, setInitialPreferencesState] = useState<{
    id: string;
    is_promotion_active: boolean;
    is_job_digest_active: boolean;
  } | null>(null);
  const { data: countries, isLoading: isLoadingLocations } = useCachedFetch<
    { location: string }[]
  >("countryData", "/api/locations", undefined, true);
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

  // Fetch current user on component mount and try to load existing data
  useEffect(() => {
    const fetchUserAndData = async () => {
      setStepLoading(true);
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        // Try to load existing user info
        const { data, error } = await supabase
          .from("user_info")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (data) {
          setInitialPreferencesState(() => ({
            id: data.user_id,
            is_promotion_active: data.is_promotion_active,
            is_job_digest_active: data.is_job_digest_active,
          }));
          setFormData((prev) => ({
            ...prev,
            ...data,
            min_salary: data.min_salary || "", // Handle null/undefined from DB
            max_salary: data.max_salary || "",
            experience_years: data.experience_years || "",
            // Resume file is not loaded from DB, only URL
            resume_file: null,
            default_locations:
              !isLoadingLocations && countries
                ? countries.map((each: { location: string }) => each.location)
                : [],
          }));
        } else if (error && error.code !== "PGRST116") {
          // PGRST116 means "no rows found"
          setError(`Failed to load user data: ${error.message}`);
        }
      } else {
        // Handle case where user is not logged in, e.g., redirect to login
        setError("User not logged in. Please log in to complete onboarding.");
      }
      setStepLoading(false);
    };

    fetchUserAndData();
  }, [countries, isLoadingLocations]); // Run once on mount

  // Validation function for current step
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
        case "industry_preferences":
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
        case "career_goals_short_term":
        case "career_goals_long_term":
        case "company_size_preference":
          if (!value) {
            newErrors[field] = "This field is required.";
            isValid = false;
          }
          break;
        case "resume_file":
          // Only validate if it's the resume upload step and no URL exists yet
          if (
            currentStep ===
              steps.findIndex((s) => s.name === "Resume Upload") &&
            !formData.resume_name &&
            !formData.resume_path
          ) {
            newErrors[field] = "Please upload your resume.";
            isValid = false;
          }
          break;
        // visa_sponsorship_required is a boolean, no specific validation needed here unless it's a required choice
      }
    });

    setFormErrors(newErrors);
    return isValid;
  }, [formData, currentStep, steps]);

  const handleNext = async () => {
    setError(null);
    // setSuccessMessage(null);

    if (!validateStep()) {
      return;
    }

    // Special handling for resume upload step
    if (steps[currentStep].name === "Resume Upload" && formData.resume_file) {
      setIsLoading(true);
      try {
        if (!user) {
          setError("User not authenticated for resume upload.");
          setIsLoading(false);
          return;
        }

        const file = formData.resume_file;
        const fileExt = file.name.split(".").pop();
        const fileName = `${uuidv4()}.${fileExt}`; // Unique file name
        const filePath = `resumes/${user.id}/${fileName}`; // Store in user's folder

        const supabase = createClient();

        const { error: uploadError } = await supabase.storage
          .from("resumes")
          .upload(filePath, file, {
            cacheControl: "3600",
            upsert: true, // Allow overwriting if file path is the same (e.g., user re-uploads)
          });

        if (uploadError) {
          setError(`Resume upload failed: ${uploadError.message}`);
          setIsLoading(false);
          return;
        }

        setFormData((prev) => ({
          ...prev,
          resume_path: filePath,
          resume_name: file.name,
        }));
      } catch (uploadException: unknown) {
        setError(
          `An unexpected error occurred during resume upload: ${
            uploadException instanceof Error
              ? uploadException.message
              : String(uploadException)
          }`
        );
      } finally {
        setIsLoading(false);
      }
    }

    if (currentStep < totalSteps - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    setError(null);
    // setSuccessMessage(null);
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    // setSuccessMessage(null);
    setIsLoading(true);

    if (!user) {
      setError("User not authenticated. Please log in.");
      setIsLoading(false);
      return;
    }

    try {
      // Prepare data for Supabase upsert
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
        resume_name: formData.resume_name,
        resume_path: formData.resume_path,
        job_type: formData.job_type,
        filled: true,
      };
      const supabase = createClient();

      const res = await fetch("/api/update-embedding/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          desired_roles: formData.desired_roles,
          preferred_locations: formData.preferred_locations,
          min_salary: formData.min_salary || 0,
          max_salary: formData.max_salary || 0,
          experience_years: formData.experience_years || 0,
          industry_preferences: formData.industry_preferences,
          visa_sponsorship_required: formData.visa_sponsorship_required,
          top_skills: formData.top_skills,
          work_style_preferences: formData.work_style_preferences,
          career_goals_short_term: formData.career_goals_short_term,
          career_goals_long_term: formData.career_goals_long_term,
          company_size_preference: formData.company_size_preference,
          resume_path: formData.resume_path,
          job_type: formData.job_type,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData);
      }

      const { error: dbError } = await supabase
        .from("user_info")
        .upsert(dataToSave, { onConflict: "user_id" });

      if (dbError) {
        setError(`Failed to save data: ${dbError.message}`);
      } else {
        toast.success("Your profile has been saved successfully!");
        router.push("/jobs");
      }
    } catch (submitException: unknown) {
      setError(
        `An unexpected error occurred during submission: ${
          submitException instanceof Error
            ? submitException.message
            : String(submitException)
        }`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const CurrentStepComponent = steps[currentStep].component;

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
    <div className="flex flex-col gap-10 items-center justify-center mt-32 mb-32  p-4">
      <div className="flex flex-col gap-5 max-w-2xl w-full">
        <p className="text-6xl font-bold ">
          Let&apos;s get you Hired, quickly.
        </p>
        {initialPreferencesState ? (
          <UserOnboardingPersonalization
            initialPreferences={initialPreferencesState}
          />
        ) : (
          ""
        )}
      </div>

      {stepLoading ? (
        <div className="h-20 flex items-center justify-center">
          <Loader2 className="animate-spin h-5 w-5" />
        </div>
      ) : (
        <Card className="w-full max-w-2xl !border-none !p-0 shadow-none">
          <CardHeader className="!p-0 mb-5">
            <Progress value={progress} className="mt-4" />
          </CardHeader>
          <CurrentStepComponent
            formData={formData}
            setFormData={setFormData}
            errors={formErrors}
            setErrors={setFormErrors}
            loadingLocations={isLoadingLocations}
          />
          {error ? toast.error(error) : ""}

          <CardFooter className="flex items-center justify-between !p-0 mt-5">
            <Button
              variant={"secondary"}
              onClick={handleBack}
              disabled={currentStep === 0 || isLoading}
            >
              Back
            </Button>
            <Button onClick={handleNext} disabled={isLoading}>
              {isLoading
                ? "Processing..."
                : currentStep === totalSteps - 1
                  ? "Submit"
                  : "Next"}
            </Button>
          </CardFooter>
          <p className="text-muted-foreground text-xs text-center mt-5">
            No need to panic, you can always update this information.
          </p>
        </Card>
      )}
    </div>
  );
};
