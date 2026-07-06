export const buildSalaryRange = (
  min_salary?: number | null,
  max_salary?: number | null,
  salary_currency?: string,
) => {
  const minSalary = min_salary || 0;
  const maxSalary = max_salary || 0;
  if (minSalary === 0 && maxSalary === 0) {
    return "Not specified";
  }
  if (minSalary === maxSalary) {
    return `${minSalary} ${salary_currency || ""}`;
  }
  if (!maxSalary) {
    return `${minSalary}${salary_currency || ""} + `;
  }
  return `${minSalary} - ${maxSalary} ${salary_currency || ""}`;
};
