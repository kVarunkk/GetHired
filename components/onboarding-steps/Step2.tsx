import { cn } from "@/utils/utils";
import { StepProps } from "../OnboardingComponent";
import { CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
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
        {/* <MultiKeywordSelect
          name="preferred_locations"
          placeholder="Select preferred locations"
          initialKeywords={formData.preferred_locations ?? []}
          onChange={(name, keywords) =>
            setFormData((prev) => ({ ...prev, [name]: keywords }))
          }
          availableItems={formData.default_locations}
          isVirtualized={true}
          loading={loadingLocations}
          className={cn(errors.preferred_locations ? "border-red-500" : "")}
        /> */}

        <LocationSearchSelect
          name={"preferred_locations"}
          initialLocations={formData.preferred_locations ?? []}
          onChange={(name, keywords) =>
            setFormData((prev) => ({ ...prev, [name]: keywords }))
          }
          placeholder={"Select preferred locations"}
          isSingleSelect={false}
          className={cn(errors.preferred_locations ? "border-red-500" : "")}
        />
      </div>

      {errors.preferred_locations && (
        <p className="text-red-500 text-sm mt-1">
          {errors.preferred_locations}
        </p>
      )}
    </div>

    <div>
      <Label htmlFor="min_salary" className="mt-4">
        Minimum Salary per annum*
      </Label>
      <div className="flex items-center gap-2">
        <Select
          value={formData.salary_currency ?? "$"}
          onValueChange={(value) =>
            setFormData({ ...formData, salary_currency: value })
          }
        >
          <SelectTrigger className="bg-input mt-2 w-[80px]">
            <SelectValue placeholder="Currency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="₹">₹</SelectItem>
            <SelectItem value="$">$</SelectItem>
            <SelectItem value="€">€</SelectItem>
            <SelectItem value="£">£</SelectItem>
            <SelectItem value="C$">C$</SelectItem>
            <SelectItem value="A$">A$</SelectItem>
          </SelectContent>
        </Select>
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
          className={cn(
            "mt-2 bg-input",
            errors.min_salary ? "border-red-500 " : "",
          )}
        />
      </div>
      {errors.min_salary && (
        <p className="text-red-500 text-sm mt-1">{errors.min_salary}</p>
      )}
    </div>

    <div>
      <Label htmlFor="max_salary" className="mt-4">
        Maximum Salary per annum
      </Label>
      <div className="flex items-center gap-2">
        <Select
          value={formData.salary_currency ?? "$"}
          onValueChange={(value) =>
            setFormData({ ...formData, salary_currency: value })
          }
        >
          <SelectTrigger className="bg-input mt-2  w-[80px]">
            <SelectValue placeholder="Currency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="₹">₹</SelectItem>
            <SelectItem value="$">$</SelectItem>
            <SelectItem value="€">€</SelectItem>
            <SelectItem value="£">£</SelectItem>
            <SelectItem value="C$">C$</SelectItem>
            <SelectItem value="A$">A$</SelectItem>
          </SelectContent>
        </Select>{" "}
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
          className={cn(
            "mt-2 bg-input",
            errors.max_salary ? "border-red-500 " : "",
          )}
        />
      </div>

      {errors.max_salary && (
        <p className="text-red-500 text-sm mt-1">{errors.max_salary}</p>
      )}
    </div>
  </CardContent>
);
