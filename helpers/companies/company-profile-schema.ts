import { z } from "zod";

/** The company profile form (`CompanyOnboardingForm`) and `saveCompanyProfileAction`. Client-safe. */
export const companyProfileSchema = z.object({
  name: z.string().trim().min(2, {
    message: "Company name must be at least 2 characters.",
  }),
  description: z
    .string()
    .trim()
    .min(200, { message: "Description is too short(min. 200 characters)." })
    .max(10000, { message: "Description is too long(max. 10000 characters)." }),
  website: z
    .string()
    .url({ message: "Invalid URL format." })
    .min(1, { message: "Website is required." }),
  industry: z.string().min(1, { message: "Industry is required." }).max(100),
  headquarters: z.string().min(1, { message: "Headquarters is required." }).max(200),
  company_size: z.string().min(1, { message: "Company size is required." }).max(20),
  tag_line: z
    .string()
    .max(70, {
      message: "Tagline is too long(max. 70 characters).",
    })
    .optional(),
});

export type CompanyProfileValues = z.infer<typeof companyProfileSchema>;

// Server actions accept bodies up to 1 MB (Next's default).
export const LOGO_MAX_BYTES = 900 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
