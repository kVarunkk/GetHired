"use client";

import { useEffect, useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { commonIndustries } from "@/utils/utils";
import { markMyOnboardingComplete } from "@/app/actions/update-user-metadata";
import LocationSearchSelect from "./LocationSearchSelect";

const formSchema = z.object({
  name: z.string().min(2, {
    message: "Company name must be at least 2 characters.",
  }),
  description: z
    .string()
    .min(200, { message: "Description is too short(min. 200 characters)." }),
  website: z
    .string()
    .url({ message: "Invalid URL format." })
    .min(1, { message: "Website is required." }),
  industry: z.string().min(1, { message: "Industry is required." }),
  headquarters: z.string().min(1, { message: "Headquarters is required." }),
  company_size: z.string().min(1, { message: "Company size is required." }),
  tag_line: z
    .string()
    .max(70, {
      message: "Tagline is too long(max. 70 characters).",
    })
    .optional(),
  logo_file: z.any().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const supabase = createClient();
const BUCKET_NAME = "images";
const LOGO_FOLDER = "company_logos";

export default function CompanyOnboardingForm({
  user,
  company,
}: {
  user: User | null;
  /** The session user's company, through `company_members` (`getMyCompany`). */
  company: { id: string; canEditProfile: boolean } | null;
}) {
  const [loading, setLoading] = useState(false);
  const [existingLogoUrl, setExistingLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const router = useRouter();
  const companyId = company?.id ?? null;
  // RP-REQ-002: owners and roles with company.profile edit it; everyone else
  // sees it read-only.
  const canEdit = company?.canEditProfile ?? false;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      website: "",
      industry: "",
      headquarters: "",
      company_size: "",
      tag_line: "",
      logo_file: undefined,
    },
  });

  const filePreviewUrl = useMemo(() => {
    if (logoFile) {
      return URL.createObjectURL(logoFile);
    }
    return null;
  }, [logoFile]);

  // --- Initial Data Load and Form Reset ---
  useEffect(() => {
    (async () => {
      if (!companyId) return;

      // By id, not company_info.user_id (the owner), so members see it too.
      const { data: existingValues } = await supabase
        .from("company_info")
        .select(
          "id, name, description, website, industry, headquarters, company_size, tag_line, logo_url",
        )
        .eq("id", companyId)
        .single();

      if (existingValues) {
        form.reset({
          name: existingValues.name || "",
          description: existingValues.description || "",
          website: existingValues.website || "",
          industry: existingValues.industry || "",
          headquarters: existingValues.headquarters || "",
          company_size: existingValues.company_size || "",
          tag_line: existingValues.tag_line || "",
        });
        if (existingValues.logo_url) {
          setExistingLogoUrl(existingValues.logo_url);
        }
      }
    })();
  }, [companyId, form]);

  // --- Supabase Storage Helpers ---

  const getFilePath = () => `${LOGO_FOLDER}/${user?.id}/logo.png`;

  const handleUploadStorage = async (file: File) => {
    const filePath = getFilePath();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: true, // Overwrite existing file
      });

    if (uploadError) throw uploadError;

    // Get the public URL for the newly uploaded file
    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);

    return publicUrl;
  };

  const handleDeleteStorage = async () => {
    const filePath = getFilePath();
    const { error: storageError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (storageError) throw storageError;
  };

  const handleDelete = () => {
    setLogoFile(null);
    if (existingLogoUrl) {
      setExistingLogoUrl(null);
      setDeletePending(true);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!user) {
      toast.error("User not authenticated.");
      return;
    }
    if (!canEdit) return;

    setLoading(true);
    let finalLogoUrl = existingLogoUrl;

    try {
      if (deletePending && existingLogoUrl) {
        await handleDeleteStorage();
        finalLogoUrl = null;
      }

      if (logoFile) {
        finalLogoUrl = await handleUploadStorage(logoFile);
      }

      const res = await fetch("/api/update-embedding/gemini/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: companyId,
          name: values.name,
          description: values.description,
          headquarters: values.headquarters,
          size: values.company_size,
          industry: values.industry,
          table: "company_info",
          user_id: user.id,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData);
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { logo_file, ...dbValues } = values;

      // TM-SEC-007: sign-up already created the row, and users have no insert
      // policy, so this is an update. Zero rows matched would otherwise mark
      // onboarding complete without saving anything.
      // By the company's id, not company_info.user_id: any owner, or a role
      // with company.profile, edits it (RLS and the column guard check).
      const update = supabase.from("company_info").update({
        ...dbValues,
        logo_url: finalLogoUrl,
        filled: true,
      });
      const { data: saved, error } = await (companyId
        ? update.eq("id", companyId)
        : update.eq("user_id", user.id)
      )
        .select("id")
        .single();

      if (error) throw error;
      if (!saved) throw new Error("Company profile not found.");

      const { error: updateAppMetaError } =
        await markMyOnboardingComplete("company");

      if (updateAppMetaError) throw new Error(updateAppMetaError);

      setLogoFile(null);
      setDeletePending(false);
      setExistingLogoUrl(finalLogoUrl);

      toast.success("Information Saved Successfully!");
      router.push("/company");
    } catch {
      toast.error(
        "An error occurred while saving information. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const companySizes = [
    "1-10",
    "11-50",
    "51-200",
    "201-500",
    "501-1000",
    "1000+",
  ];

  const currentLogoDisplayUrl = filePreviewUrl || existingLogoUrl;

  if (!company) {
    return (
      <div className="flex flex-col w-full gap-8 p-4 mb-20">
        <h1 className="text-3xl font-medium">Company Profile</h1>
        <div className="max-w-2xl w-full rounded-lg border p-6">
          <p className="font-semibold">
            Your account isn&apos;t part of a company
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            If you were invited, open the link in your invite email. Otherwise,
            ask an admin of your company for a new invite.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-8 p-4 mb-20">
      <h1 className="text-3xl font-medium">Company Profile</h1>
      <div className="flex flex-col gap-5 max-w-2xl w-full">
        {!canEdit && (
          <p className="text-sm text-muted-foreground">
            Your role can&apos;t edit the company profile.
          </p>
        )}
        <Link
          href={`/companies/${companyId}`}
          className="text-sm font-medium underline underline-offset-4 flex items-center gap-1 transition-colors hover:text-brand"
          target="_blank"
          rel="noopener noreferrer"
        >
          View Public Profile <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="w-full max-w-2xl"
        >
          <fieldset disabled={!canEdit} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Company Name <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Inc." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormItem>
              <FormLabel>Company Logo</FormLabel>
              <div className="flex items-center space-x-4">
                {currentLogoDisplayUrl && (
                  <div className="relative h-20 w-20 flex-shrink-0 rounded-lg border p-1">
                    <img
                      src={currentLogoDisplayUrl}
                      alt="Company Logo Preview"
                      width={80}
                      height={80}
                      className="rounded-lg"
                    />
                    {canEdit && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                        onClick={handleDelete}
                        disabled={loading}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
                {!canEdit && !currentLogoDisplayUrl && (
                  <p className="text-sm text-muted-foreground">No logo</p>
                )}

                {canEdit && (
                  <div className="flex-grow">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        if (file) {
                          setLogoFile(file);
                          setDeletePending(false);
                        }
                      }}
                      className="h-10 p-2"
                      disabled={loading}
                      style={{
                        display:
                          currentLogoDisplayUrl && !logoFile ? "none" : "block",
                      }}
                    />
                    <p
                      className="text-sm text-muted-foreground mt-1"
                      style={{
                        display:
                          currentLogoDisplayUrl && !logoFile ? "none" : "block",
                      }}
                    >
                      PNG or JPG recommended. Max 1MB.
                    </p>
                  </div>
                )}
              </div>
              <FormMessage />
            </FormItem>

            <FormField
              control={form.control}
              name="tag_line"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tagline</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Eg. Your Smartest Path to the perfect job"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Company Description{" "}
                    <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Tell us a little bit about your company..."
                      className="resize-y h-[200px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Company Website{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="https://www.acme.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="industry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Industry <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Industry" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {commonIndustries.map((industry) => (
                            <SelectItem key={industry} value={industry}>
                              {industry}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="headquarters"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Headquarters Location{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <LocationSearchSelect
                        name={field.name}
                        initialLocations={[field.value]}
                        onChange={(name, selectedLocations) =>
                          field.onChange(selectedLocations?.[0])
                        }
                        placeholder="Select preferred locations"
                        isSingleSelect={true}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="company_size"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Company Size <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select size" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {companySizes.map((size) => (
                          <SelectItem key={size} value={size}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {canEdit && (
              <Button
                type="submit"
                variant="brand"
                className="w-full"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Complete Onboarding"
                )}
              </Button>
            )}
          </fieldset>
        </form>
      </Form>
      {canEdit && (
        <p className="w-full max-w-2xl text-muted-foreground text-xs text-center -mt-3">
          No need to panic, you can always update this information.
        </p>
      )}
    </div>
  );
}
