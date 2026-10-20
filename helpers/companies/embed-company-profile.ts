import { embed } from "ai";
import { google } from "@ai-sdk/google";
import type { CompanyProfileValues } from "./company-profile-schema";

/** The company's profile vector, used to match candidates and companies. */
export async function embedCompanyProfile(values: CompanyProfileValues): Promise<number[]> {
  const textToEmbed = `
     DESCRIPTION: ${values.description || "N/A"}

     HEADQUARTERS: ${values.headquarters || "N/A"}
     
     SIZE: ${values.company_size || "N/A"}
     
     INDUSTRY TYPE: ${values.industry || "N/A"}
    `.trim();

  const { embedding } = await embed({
    model: google.embedding("gemini-embedding-001"),
    value: textToEmbed,
    providerOptions: {
      google: {
        outputDimensionality: 768,
      },
    },
  });
  if (!embedding) throw new Error("Failed to generate embedding.");
  return embedding;
}
