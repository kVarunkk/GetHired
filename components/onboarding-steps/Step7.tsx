import { StepProps } from "../OnboardingComponent";
import { CardContent } from "../ui/card";

export const Step7ReviewSubmit: React.FC<StepProps> = ({ formData }) => (
  <CardContent className="!p-0">
    <h3 className="text-lg font-semibold tracking-tight mb-4">
      Review Your Information
    </h3>

    <div className="divide-y rounded-xl border">
      {/* Section 1: Job & Location Preferences */}
      <div className="p-4">
        <h4 className="text-sm font-medium mb-2">Job & Location Preferences</h4>
        <div className="space-y-1 text-sm ">
          <p>
            <span className="text-muted-foreground">Full Name:</span>{" "}
            {formData.full_name || "N/A"}
          </p>
          <p>
            <span className="text-muted-foreground">Desired Roles:</span>{" "}
            {formData.desired_roles.join(", ") || "N/A"}
          </p>
          <p>
            <span className="text-muted-foreground">Preferred Locations:</span>{" "}
            {formData.preferred_locations.join(", ") || "N/A"}
          </p>
          <p>
            <span className="text-muted-foreground">Salary Range:</span>{" "}
            {formData.min_salary || "N/A"}
            {formData.salary_currency} - {formData.max_salary || "N/A"}
            {formData.salary_currency}
          </p>
        </div>
      </div>

      {/* Section 2: Experience & Skills */}
      <div className="p-4">
        <h4 className="text-sm font-medium mb-2">Experience & Skills</h4>
        <div className="space-y-1 text-sm ">
          <p>
            <span className="text-muted-foreground">Years of Experience:</span>{" "}
            {formData.experience_years || "N/A"}
          </p>
          <p>
            <span className="text-muted-foreground">Top Skills:</span>{" "}
            {formData.top_skills.join(", ") || "N/A"}
          </p>
        </div>
      </div>

      {/* Section 3: Work & Company Preferences */}
      <div className="p-4">
        <h4 className="text-sm font-medium mb-2">Work & Company Preferences</h4>
        <div className="space-y-1 text-sm ">
          <p>
            <span className="text-muted-foreground">
              Visa Sponsorship Required:
            </span>{" "}
            {formData.visa_sponsorship_required ? "Yes" : "No"}
          </p>
          <p>
            <span className="text-muted-foreground">Industry Preferences:</span>{" "}
            {formData.industry_preferences.join(", ") || "N/A"}
          </p>
          <p>
            <span className="text-muted-foreground">
              Work Style Preferences:
            </span>{" "}
            {formData.work_style_preferences.join(", ") || "N/A"}
          </p>
          <p>
            <span className="text-muted-foreground">
              Company Size Preference:
            </span>{" "}
            {formData.company_size_preference || "N/A"}
          </p>
        </div>
      </div>

      {/* Section 4: Career Goals */}
      <div className="p-4">
        <h4 className="text-sm font-medium mb-2">Career Goals</h4>
        <div className="space-y-1 text-sm ">
          <p>
            <span className="text-muted-foreground">Short-term Goals:</span>{" "}
            {formData.career_goals_short_term || "N/A"}
          </p>
          <p>
            <span className="text-muted-foreground">Long-term Goals:</span>{" "}
            {formData.career_goals_long_term || "N/A"}
          </p>
        </div>
      </div>

      {/* Section 5: Resume */}
      <div className="p-4">
        <h4 className="text-sm font-medium mb-2">Resume</h4>
        <div className="space-y-1 text-sm ">
          <p>
            <span className="text-muted-foreground">Resume File:</span>{" "}
            {formData.resume_id ? "Stored" : "Not Stored"}
          </p>
        </div>
      </div>
    </div>
  </CardContent>
);
