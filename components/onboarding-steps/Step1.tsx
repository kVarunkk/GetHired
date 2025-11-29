import { StepProps } from "../OnboardingComponent";
import { CardContent } from "../ui/card";
import { Label } from "../ui/label";
import { Input } from "../ui/input";

import { cn, commonJobTitles } from "@/lib/utils";
import MultiKeywordSelectInput from "../MultiKeywordSelectInput";
import MultiKeywordSelect from "../MultiKeywordSelect";
export const Step1JobRole = ({ formData, setFormData, errors }: StepProps) => {
  return (
    <CardContent className="flex flex-col gap-4 !p-0">
      <div>
        <Label htmlFor="full_name">Full Name</Label>
        <Input
          id="full_name"
          type="text"
          placeholder="e.g., John Doe"
          value={formData.full_name ?? ""}
          onChange={(e) =>
            setFormData({ ...formData, full_name: e.target.value })
          }
          className={cn(
            "mt-2 bg-input",
            errors.full_name ? "border-red-500" : ""
          )}
        />

        {errors.full_name && (
          <p className="text-red-500 text-sm mt-1">{errors.full_name}</p>
        )}
      </div>

      <div>
        <Label htmlFor="full_name">LinkedIn Profile</Label>
        <Input
          id="linkedin_url"
          type="url"
          placeholder="e.g., https://www.linkedin.com/in/johndoe"
          value={formData.linkedin_url ?? ""}
          onChange={(e) =>
            setFormData({ ...formData, linkedin_url: e.target.value })
          }
          className={cn(
            "mt-2 bg-input",
            errors.linkedin_url ? "border-red-500" : ""
          )}
        />

        {errors.linkedin_url && (
          <p className="text-red-500 text-sm mt-1">{errors.linkedin_url}</p>
        )}
      </div>

      <div>
        <Label htmlFor="github_url">GitHub URL</Label>
        <Input
          id="github_url"
          type="url"
          placeholder="e.g., https://github.com/johndoe"
          value={formData.github_url ?? ""}
          onChange={(e) =>
            setFormData({ ...formData, github_url: e.target.value })
          }
          className={cn(
            "mt-2 bg-input",
            errors.github_url ? "border-red-500" : ""
          )}
        />

        {errors.github_url && (
          <p className="text-red-500 text-sm mt-1">{errors.github_url}</p>
        )}
      </div>

      <div>
        <Label htmlFor="desired_roles">Desired Job Titles / Roles</Label>

        <div className="mt-2">
          <MultiKeywordSelectInput
            name="desired_roles"
            label="Desired Job Titles / Roles" // Using the new label prop
            placeholder="Type or select from dropdown"
            initialKeywords={formData.desired_roles ?? []}
            onChange={(name, keywords) =>
              setFormData((prev) => ({ ...prev, [name]: keywords }))
            }
            availableItems={commonJobTitles}
            className={cn(errors.desired_roles ? "border-red-500" : "")}
          />
        </div>

        {errors.desired_roles && (
          <p className="text-red-500 text-sm mt-1">{errors.desired_roles}</p>
        )}
      </div>

      <div>
        <Label htmlFor="job_type">What type of job are you looking for?</Label>

        <MultiKeywordSelect
          name={"job_type"}
          placeholder="e.g., Fulltime, Intern"
          initialKeywords={formData.job_type ?? []}
          onChange={(name, keywords) => {
            setFormData({
              ...formData,
              [name]: keywords,
            });
          }}
          className={cn("mt-2 ", errors.job_type ? "border-red-500" : "")}
          availableItems={["Fulltime", "Intern", "Contract"]}
        />

        {errors.job_type && (
          <p className="text-red-500 text-sm mt-1">{errors.job_type}</p>
        )}
      </div>
    </CardContent>
  );
};
