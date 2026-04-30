import { FilterConfig, TApplicationStatus } from "@/utils/types";

const toOptions = (list?: { location: string }[]) =>
  list?.map((each) => ({ value: each.location, label: each.location })) || [];

export const filterConfigBuilder = (
  currentPage: "jobs" | "profiles" | "companies",
  uniqueCompanies?: { company_name: string }[],
  uniqueLocations?: { location: string }[],
  uniqueJobRoles?: { job_role: string }[],
  uniqueIndustryPreferences?: { industry_preference: string }[],
  uniqueSkills?: { skill: string }[],
  uniqueWorkStylePreferences?: { work_style_preference: string }[],
  countries?: { location: string }[],
  uniqueIndustries?: { industry: string }[],
  onboardingComplete?: boolean,
) => {
  let config: FilterConfig[] = [];
  switch (currentPage) {
    case "jobs":
      config = [
        {
          name: "jobType",
          label: "Job Type",
          type: "multi-select",
          placeholder: "Select the type of Job",
          options: [
            { value: "Fulltime", label: "Full Time" },
            { value: "Intern", label: "Internship" },
            { value: "Contract", label: "Contract" },
          ],
        },
        {
          name: "jobTitleKeywords",
          label: "Job Title Keywords",
          type: "multi-select-input",
          placeholder: "Type or select from dropdown",
          options: [
            { value: "Engineer", label: "Engineer" },
            { value: "Developer", label: "Developer" },
            { value: "Manager", label: "Manager" },
            { value: "Analyst", label: "Analyst" },
            { value: "Lead", label: "Lead" },
            { value: "Senior", label: "Senior" },
            { value: "Junior", label: "Junior" },
            { value: "Director", label: "Director" },
            { value: "Architect", label: "Architect" },
            { value: "Specialist", label: "Specialist" },
          ],
        },
        {
          name: "location",
          label: "Location",
          type: "multi-select",
          placeholder: "Select the location of Job",
          options: countries ? toOptions(countries) : [],
          isVirtualized: true,
        },
        {
          name: "visaRequirement",
          label: "Visa Requirement",
          type: "multi-select",
          placeholder: "Select the Visa configuration",
          options: [
            {
              value: "US Citizenship/Visa Not Required",
              label: "US Citizenship/Visa Not Required",
            },
            { value: "Will Sponsor", label: "Will Sponsor" },
            { value: "US Citizen/Visa Only", label: "US Citizen/Visa Only" },
          ],
        },

        {
          name: "companyName",
          label: "Company",
          type: "multi-select",
          placeholder: "Select the company",
          options: uniqueCompanies?.map((each) => ({
            value: each.company_name,
            label: each.company_name,
          })),
          isVirtualized: true,
        },
        {
          name: "platform",
          label: "Platform",
          type: "multi-select",
          placeholder: "Select the platform",
          options: [
            { value: "ycombinator", label: "YCombinator" },
            { value: "wellfound", label: "Wellfound" },
            { value: "khosla", label: "Khosla Ventures" },
            { value: "sierra", label: "Sierra Ventures" },
            { value: "accel", label: "Accel" },
            { value: "workingnomads", label: "Working Nomads" },
            { value: "jobleads", label: "JobLeads" },
            { value: "glassdoor", label: "Glassdoor" },
            { value: "greenhouse", label: "Greenhouse" },
            { value: "weworkremotely", label: "We Work Remotely" },
            { value: "remoteok", label: "Remote Ok" },
            { value: "uplers", label: "Uplers" },
            { value: "gethired", label: "GetHired" },
          ],
        },
        {
          name: "applicationStatus",
          label: "Application Status",
          type: "multi-select",
          placeholder: "Select the status",
          options: Object.keys(TApplicationStatus).map((each) => ({
            label: each,
            value: TApplicationStatus[each as keyof typeof TApplicationStatus],
          })),
          hidden: !onboardingComplete,
        },

        {
          name: "minSalary",
          label: "Minimum Salary",
          type: "number",
          placeholder: "e.g., 80000",
        },
        {
          name: "minExperience",
          label: "Minimum Experience (years)",
          type: "number",
          placeholder: "e.g., 2",
        },
        {
          name: "createdAfter",
          label: "Date Posted",
          type: "multi-select",
          placeholder: "Select Job Posting Date",
          options: [
            { value: "Last 24 hrs", label: "1" },
            { value: "Last 3 days", label: "3" },
            { value: "Last 7 days", label: "7" },
            { value: "Last 14 days", label: "14" },
          ],
          isSingleSelect: true,
        },
      ];
      break;
    case "profiles":
      config = [
        {
          name: "jobType",
          label: "Job Type",
          type: "multi-select",
          placeholder: "Select the type of Job",
          options: [
            { value: "Fulltime", label: "Full Time" },
            { value: "Intern", label: "Internship" },
            { value: "Contract", label: "Contract" },
          ],
        },
        {
          name: "jobRole",
          label: "Job Role",
          type: "multi-select",
          placeholder: "Select the Job Role",
          options: uniqueJobRoles?.map((each) => ({
            value: each.job_role,
            label: each.job_role,
          })),
        },
        {
          name: "industryPreference",
          label: "Industry Preference",
          type: "multi-select",
          placeholder: "Select the Industry Preference",
          options: uniqueIndustryPreferences?.map((each) => ({
            value: each.industry_preference,
            label: each.industry_preference,
          })),
        },
        {
          name: "workStylePreference",
          label: "Work Style Preference",
          type: "multi-select",
          placeholder: "Select the Work Style Preference",
          options: uniqueWorkStylePreferences?.map((each) => ({
            value: each.work_style_preference,
            label: each.work_style_preference,
          })),
        },
        {
          name: "skills",
          label: "Skills",
          type: "multi-select",
          placeholder: "Select the Skills",
          options: uniqueSkills?.map((each) => ({
            value: each.skill,
            label: each.skill,
          })),
        },
        {
          name: "location",
          label: "Location",
          type: "multi-select",
          placeholder: "Select the location of Job",

          options: uniqueLocations?.map((each) => ({
            value: each.location,
            label: each.location,
          })),
        },

        {
          name: "maxSalary",
          label: "Maximum Salary",
          type: "number",
          placeholder: "e.g., 80000",
        },
        {
          name: "minExperience",
          label: "Minimum Experience (years)",
          type: "number",
          placeholder: "e.g., 2",
        },
      ];
      break;
    case "companies":
      config = [
        {
          name: "name",
          label: "Company",
          type: "multi-select",
          placeholder: "Select the Company",
          options: uniqueCompanies?.map((each) => ({
            value: each.company_name,
            label: each.company_name,
          })),
        },
        {
          name: "location",
          label: "Location",
          type: "multi-select",
          placeholder: "Select the location of Company",
          options: uniqueLocations?.map((each) => ({
            value: each.location,
            label: each.location,
          })),
          isVirtualized: true,
        },
        {
          name: "industry",
          label: "Industry",
          type: "multi-select",
          placeholder: "Select the Industry type",
          options: uniqueIndustries?.map((each) => ({
            value: each.industry,
            label: each.industry,
          })),
          isVirtualized: true,
        },
        {
          name: "size",
          label: "Size",
          type: "multi-select",
          placeholder: "Select the Size",
          options: [
            "1-10",
            "11-50",
            "51-200",
            "201-500",
            "501-1000",
            "1000+",
          ].map((each) => ({
            value: each,
            label: each,
          })),
          isVirtualized: false,
        },
      ];
      break;
  }
  return config;
};
