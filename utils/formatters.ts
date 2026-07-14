export const deploymentUrl = () => {
  if (process.env.RENDER) {
    return "https://gethired.devhub.co.in";
  } else return "http://localhost:3000";
};

export const parseMultiSelectParam = <T extends string>(
  param: string | null | undefined,
): T[] => {
  return param
    ? (param
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean) as T[])
    : [];
};

export const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

export const buildEquityRange = (equity_min?: number, equity_max?: number) => {
  if (equity_max && equity_min) {
    return `${equity_min}% - ${equity_max}%`;
  } else if (!equity_max && equity_min) {
    return `${equity_min}% +`;
  } else return null;
};

export const buildExperience = (exp_min?: number, exp_max?: number) => {
  if (exp_max && exp_min) {
    return `${exp_min} - ${exp_max} Years`;
  } else if (!exp_max && exp_min) {
    return `${exp_min}+ Years`;
  } else return null;
};
