import { cn } from "@/lib/utils";
import { StepProps } from "../OnboardingComponent";
import { CardContent } from "../ui/card";

export const Step7ReviewSubmit: React.FC<StepProps> = ({ formData }) => (
  <CardContent className="!p-0">
    <h3 className="text-lg font-semibold mb-4">Review Your Information</h3>

    {/* Section 1: Job & Location Preferences */}
    <div className={cn(" p-4 rounded-md border border-border mb-4")}>
      <h4 className="font-semibold  mb-2">Job & Location Preferences</h4>
      <div className="space-y-1 text-sm ">
        <p>
          <span>Full Name:</span> {formData.full_name || "N/A"}
        </p>
        <p>
          <span>Desired Roles:</span>{" "}
          {formData.desired_roles.join(", ") || "N/A"}
        </p>
        <p>
          <span>Preferred Locations:</span>{" "}
          {formData.preferred_locations.join(", ") || "N/A"}
        </p>
        <p>
          <span>Salary Range:</span> {formData.min_salary || "N/A"}
          {formData.salary_currency} - {formData.max_salary || "N/A"}
          {formData.salary_currency}
        </p>
      </div>
    </div>

    {/* Section 2: Experience & Skills */}
    <div className={cn(" p-4 rounded-md border border-border mb-4")}>
      <h4 className="font-semibold  mb-2">Experience & Skills</h4>
      <div className="space-y-1 text-sm ">
        <p>
          <span>Years of Experience:</span> {formData.experience_years || "N/A"}
        </p>
        <p>
          <span>Top Skills:</span> {formData.top_skills.join(", ") || "N/A"}
        </p>
      </div>
    </div>

    {/* Section 3: Work & Company Preferences */}
    <div className={cn(" p-4 rounded-md border border-border mb-4")}>
      <h4 className="font-semibold  mb-2">Work & Company Preferences</h4>
      <div className="space-y-1 text-sm ">
        <p>
          <span>Visa Sponsorship Required:</span>{" "}
          {formData.visa_sponsorship_required ? "Yes" : "No"}
        </p>
        <p>
          <span>Industry Preferences:</span>{" "}
          {formData.industry_preferences.join(", ") || "N/A"}
        </p>
        <p>
          <span>Work Style Preferences:</span>{" "}
          {formData.work_style_preferences.join(", ") || "N/A"}
        </p>
        <p>
          <span>Company Size Preference:</span>{" "}
          {formData.company_size_preference || "N/A"}
        </p>
      </div>
    </div>

    {/* Section 4: Career Goals */}
    <div className={cn(" p-4 rounded-md border border-border mb-4")}>
      <h4 className="font-semibold  mb-2">Career Goals</h4>
      <div className="space-y-1 text-sm ">
        <p>
          <span>Short-term Goals:</span>{" "}
          {formData.career_goals_short_term || "N/A"}
        </p>
        <p>
          <span>Long-term Goals:</span>{" "}
          {formData.career_goals_long_term || "N/A"}
        </p>
      </div>
    </div>

    {/* Section 5: Resume */}
    <div className={cn(" p-4 rounded-md border border-border")}>
      <h4 className="font-semibold  mb-2">Resume</h4>
      <div className="space-y-1 text-sm ">
        <p>
          <span>Resume File:</span>{" "}
          {formData.resume_id ? "Stored" : "Not Stored"}
        </p>
      </div>
    </div>
  </CardContent>
);
