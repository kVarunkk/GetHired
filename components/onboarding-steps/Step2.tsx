import { cn } from "@/utils/utils";
import { StepProps } from "../OnboardingComponent";
import { CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import CurrencySelect from "../CurrencySelect";
import InfoTooltip from "../InfoTooltip";
import LocationSearchSelect from "../LocationSearchSelect";

export const Step2LocationSalary: React.FC<StepProps> = ({
  formData,
  setFormData,
  errors,
}) => (
  <CardContent className="flex flex-col gap-4 !p-0">
    <div>
      <Label htmlFor="preferred_locations">
        Preferred Locations*
        <InfoTooltip
          content={<p>Make sure to select cities for better job matches.</p>}
        />
      </Label>

      <div className="mt-2">
        <LocationSearchSelect
          name={"preferred_locations"}
          initialLocations={formData.preferred_locations ?? []}
          onChange={(name, keywords) =>
            setFormData((prev) => ({ ...prev, [name]: keywords }))
          }
          placeholder={"Select preferred locations"}
          isSingleSelect={false}
          className={cn(errors.preferred_locations ? "border-destructive" : "")}
        />
      </div>

      {errors.preferred_locations && (
        <p className="text-destructive text-sm mt-1">
          {errors.preferred_locations}
        </p>
      )}
    </div>

    <div>
      <Label htmlFor="salary_currency" className="mt-4">
        Salary currency*
      </Label>
      <CurrencySelect
        id="salary_currency"
        value={formData.salary_currency}
        onChange={(code) => setFormData({ ...formData, salary_currency: code })}
        aria-invalid={!!errors.salary_currency}
        className="mt-2"
      />
      {errors.salary_currency && (
        <p className="text-destructive text-sm mt-1">{errors.salary_currency}</p>
      )}
    </div>

    <div>
      <Label htmlFor="min_salary" className="mt-4">
        Minimum Salary per annum*
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="min_salary"
          type="number"
          placeholder="e.g., 60000"
          value={formData.min_salary}
          onChange={(e) =>
            setFormData({
              ...formData,
              min_salary: e.target.value === "" ? "" : parseInt(e.target.value),
            })
          }
          aria-invalid={!!errors.min_salary}
          className="mt-2"
        />
      </div>
      {errors.min_salary && (
        <p className="text-destructive text-sm mt-1">{errors.min_salary}</p>
      )}
    </div>

    <div>
      <Label htmlFor="max_salary" className="mt-4">
        Maximum Salary per annum
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="max_salary"
          type="number"
          placeholder="e.g., 90000"
          value={formData.max_salary}
          onChange={(e) =>
            setFormData({
              ...formData,
              max_salary: e.target.value === "" ? "" : parseInt(e.target.value),
            })
          }
          aria-invalid={!!errors.max_salary}
          className="mt-2"
        />
      </div>

      {errors.max_salary && (
        <p className="text-destructive text-sm mt-1">{errors.max_salary}</p>
      )}
    </div>
  </CardContent>
);
