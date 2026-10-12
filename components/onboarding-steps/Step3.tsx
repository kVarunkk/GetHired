import { cn, commonSkills } from "@/utils/utils";
import { StepProps } from "../OnboardingComponent";
import { CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import MultiKeywordSelectInput from "../MultiKeywordSelectInput";

export const Step3SkillsExperience: React.FC<StepProps> = ({
  formData,
  setFormData,
  errors,
}) => (
  <CardContent className="flex flex-col gap-4 !p-0">
    <div>
      <Label htmlFor="experience_years">
        Years of Professional Experience*
      </Label>
      <Input
        id="experience_years"
        type="number"
        placeholder="e.g., 5"
        value={formData.experience_years}
        onChange={(e) =>
          setFormData({
            ...formData,
            experience_years:
              e.target.value === "" ? "" : parseInt(e.target.value),
          })
        }
        aria-invalid={!!errors.experience_years}
        className="mt-2"
      />
      {errors.experience_years && (
        <p className="text-destructive text-sm mt-1">
          {errors.experience_years}
        </p>
      )}
    </div>

    <div>
      <Label htmlFor="top_skills" className="mt-4">
        Top 5-10 Skills*
      </Label>

      <div className="mt-2">
        <MultiKeywordSelectInput
          name="top_skills"
          placeholder="Type or select from dropdown"
          initialKeywords={formData.top_skills ?? []}
          onChange={(name, keywords) =>
            setFormData((prev) => ({ ...prev, [name]: keywords }))
          }
          availableItems={commonSkills}
          className={cn(errors.top_skills ? "border-destructive" : "")}
        />
      </div>

      {errors.top_skills && (
        <p className="text-destructive text-sm mt-1">{errors.top_skills}</p>
      )}
    </div>
  </CardContent>
);
