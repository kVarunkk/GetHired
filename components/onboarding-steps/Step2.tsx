import { cn } from "@/utils/utils";
import type { IFormData, StepProps } from "../OnboardingComponent";
import { CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import CurrencySelect from "../CurrencySelect";
import InfoTooltip from "../InfoTooltip";
import LocationSearchSelect from "../LocationSearchSelect";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  HOURS_PER_WEEK,
  isSalaryPeriod,
  lowSalaryHint,
  SALARY_PERIOD_LABELS,
  SALARY_PERIODS,
  type SalaryPeriod,
  formatSalaryAmount,
  salaryEquivalents,
} from "@/helpers/salary/period";

const SALARY_PLACEHOLDERS: Record<SalaryPeriod, { min: string; max: string }> = {
  year: { min: "e.g., 60000", max: "e.g., 90000" },
  month: { min: "e.g., 5000", max: "e.g., 7500" },
  hour: { min: "e.g., 30", max: "e.g., 45" },
};

/**
 * One salary amount in the chosen period, with what it comes to in the other
 * periods and, when it's low for a year, a warning (with a one-click switch
 * to per month when that makes sense).
 */
function SalaryInput({
  field,
  label,
  placeholder,
  formData,
  setFormData,
  error,
}: {
  field: "min_salary" | "max_salary";
  label: string;
  placeholder: string;
  formData: IFormData;
  setFormData: StepProps["setFormData"];
  error?: string;
}) {
  const amount = formData[field];
  const currency = formData.salary_currency;
  const hint =
    typeof amount === "number"
      ? lowSalaryHint(amount, formData.salary_period, currency)
      : null;

  return (
    <div>
      <Label htmlFor={field} className="mt-4">
        {label}
      </Label>
      <Input
        id={field}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        placeholder={placeholder}
        value={amount}
        onChange={(e) => {
          const value = e.target.value === "" ? "" : Number(e.target.value);
          setFormData((prev) => ({ ...prev, [field]: value }));
        }}
        aria-invalid={!!error}
        aria-describedby={`${field}_hint`}
        className="mt-2"
      />
      {typeof amount === "number" && amount > 0 && currency && (
        <p id={`${field}_hint`} className="mt-1 text-sm text-muted-foreground">
          {salaryEquivalents(amount, formData.salary_period, currency)}
        </p>
      )}
      {hint && typeof amount === "number" && (
        <div
          role="status"
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1">
            {formatSalaryAmount(amount, currency)} is low for a year.{" "}
            {hint.kind === "month"
              ? `If that's per month, it's ${formatSalaryAmount(hint.annual, currency)} a year.`
              : "Check the amount and the salary period."}
          </span>
          {hint.kind === "month" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setFormData((prev) => ({ ...prev, salary_period: "month" }))}
            >
              It&apos;s per month
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-destructive text-sm mt-1">{error}</p>}
    </div>
  );
}

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
      <Label htmlFor="salary_period" className="mt-4">
        Salary period*
      </Label>
      <Select
        value={formData.salary_period}
        onValueChange={(value) => {
          if (isSalaryPeriod(value)) setFormData({ ...formData, salary_period: value });
        }}
      >
        <SelectTrigger id="salary_period" className="mt-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SALARY_PERIODS.map((period) => (
            <SelectItem key={period} value={period}>
              {SALARY_PERIOD_LABELS[period]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter it the way you think of it. We save it as a yearly amount
        {formData.salary_period === "hour" &&
          `, assuming ${HOURS_PER_WEEK} hours a week`}
        .
      </p>
    </div>

    <SalaryInput
      field="min_salary"
      label="Minimum salary*"
      placeholder={SALARY_PLACEHOLDERS[formData.salary_period].min}
      formData={formData}
      setFormData={setFormData}
      error={errors.min_salary}
    />

    <SalaryInput
      field="max_salary"
      label="Maximum salary"
      placeholder={SALARY_PLACEHOLDERS[formData.salary_period].max}
      formData={formData}
      setFormData={setFormData}
      error={errors.max_salary}
    />
  </CardContent>
);
