import { cn } from "@/lib/utils";
import { StepProps } from "../OnboardingComponent";
import { CardContent } from "../ui/card";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";

export const Step5CareerGoals: React.FC<StepProps> = ({
  formData,
  setFormData,
  errors,
}) => (
  <CardContent className="flex flex-col gap-4 !p-0">
    <div>
      <Label htmlFor="career_goals_short_term">
        Short-term Career Goals (1-2 years)
      </Label>
      <Textarea
        id="career_goals_short_term"
        placeholder="e.g., Land a senior software engineering role focusing on AI."
        value={formData.career_goals_short_term ?? ""}
        onChange={(e) =>
          setFormData({ ...formData, career_goals_short_term: e.target.value })
        }
        className={cn(
          "mt-2 bg-input",
          errors.career_goals_short_term ? "border-red-500 " : ""
        )}
      />
      {errors.career_goals_short_term && (
        <p className="text-red-500 text-sm mt-1">
          {errors.career_goals_short_term}
        </p>
      )}
    </div>

    <div>
      <Label htmlFor="career_goals_long_term" className="mt-4">
        Long-term Career Goals (3-5 years)
      </Label>
      <Textarea
        id="career_goals_long_term"
        placeholder="e.g., Become a tech lead or start my own AI-driven company."
        value={formData.career_goals_long_term}
        onChange={(e) =>
          setFormData({ ...formData, career_goals_long_term: e.target.value })
        }
        className={cn(
          "mt-2 bg-input",
          errors.career_goals_long_term ? "border-red-500 " : ""
        )}
      />
      {errors.career_goals_long_term && (
        <p className="text-red-500 text-sm mt-1">
          {errors.career_goals_long_term}
        </p>
      )}
    </div>

    <div>
      <Label htmlFor="company_size_preference" className="mt-4">
        Preferred Company Size
      </Label>
      <Select
        onValueChange={(value) =>
          setFormData({ ...formData, company_size_preference: value })
        }
        value={formData.company_size_preference}
      >
        <SelectTrigger className="mt-2 bg-input">
          <SelectValue
            placeholder="Select company size"
            className={cn(
              errors.company_size_preference ? "border-red-500 " : ""
            )}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Small (1-50)">Small (1-50 employees)</SelectItem>
          <SelectItem value="Medium (51-500)">
            Medium (51-500 employees)
          </SelectItem>
          <SelectItem value="Large (500+)">Large (500+ employees)</SelectItem>
          <SelectItem value="Any">Any Size</SelectItem>
        </SelectContent>
      </Select>
      {errors.company_size_preference && (
        <p className="text-red-500 text-sm mt-1">
          {errors.company_size_preference}
        </p>
      )}
    </div>
  </CardContent>
);
