import { cn, commonIndustries, commonWorkStyles } from "@/lib/utils";
import MultiKeywordSelectInput from "../MultiKeywordSelectInput";
import { StepProps } from "../OnboardingComponent";
import { CardContent } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";

export const Step4VisaWorkStyle: React.FC<StepProps> = ({
  formData,
  setFormData,
  errors,
}) => (
  <CardContent className="flex flex-col gap-4 !p-0">
    <div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="visa_sponsorship_required"
          checked={formData.visa_sponsorship_required}
          onCheckedChange={(checked) =>
            setFormData({
              ...formData,
              visa_sponsorship_required: checked as boolean,
            })
          }
          className={errors.visa_sponsorship_required ? "border-red-500" : ""}
        />
        <Label>Do you require Visa Sponsorship?</Label>
      </div>

      {errors.visa_sponsorship_required && (
        <p className="text-red-500 text-sm mt-1">
          {errors.visa_sponsorship_required}
        </p>
      )}
    </div>

    <div>
      <Label htmlFor="industry_preferences" className="mt-4">
        Industry Preferences
      </Label>

      <div className="mt-2">
        <MultiKeywordSelectInput
          name="industry_preferences"
          placeholder="Type or select from dropdown"
          initialKeywords={formData.industry_preferences ?? []}
          onChange={(name, keywords) =>
            setFormData((prev) => ({ ...prev, [name]: keywords }))
          }
          availableItems={commonIndustries}
          className={cn(errors.industry_preferences ? "border-red-500" : "")}
        />
      </div>

      {errors.industry_preferences && (
        <p className="text-red-500 text-sm mt-1">
          {errors.industry_preferences}
        </p>
      )}
    </div>

    <div>
      <Label htmlFor="work_style_preferences" className="mt-4">
        Preferred Work Styles
      </Label>

      <div className="mt-2">
        <MultiKeywordSelectInput
          name="work_style_preferences"
          placeholder="Type or select from dropdown"
          initialKeywords={formData.work_style_preferences ?? []}
          onChange={(name, keywords) =>
            setFormData((prev) => ({ ...prev, [name]: keywords }))
          }
          availableItems={commonWorkStyles}
          className={cn(errors.work_style_preferences ? "border-red-500" : "")}
        />
      </div>

      {errors.work_style_preferences && (
        <p className="text-red-500 text-sm mt-1">
          {errors.work_style_preferences}
        </p>
      )}
    </div>
  </CardContent>
);
