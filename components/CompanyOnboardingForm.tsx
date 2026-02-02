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
import { LocationSelector } from "./LocationSelector";
import { commonIndustries } from "@/lib/utils";
import { updateUserAppMetadata } from "@/app/actions/update-user-metadata";

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
  // logo_file is not validated here; logic handles its optionality
  logo_file: z.any().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const supabase = createClient();
const BUCKET_NAME = "images";
const LOGO_FOLDER = "company_logos";

export default function CompanyOnboardingForm({ user }: { user: User | null }) {
  const [loading, setLoading] = useState(false);
  // Tracks the *existing* logo URL from the database
  const [existingLogoUrl, setExistingLogoUrl] = useState<string | null>(null);
  // Tracks the *new* file selected by the user for upload
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Tracks if the user clicked delete on an *existing* logo
  const [deletePending, setDeletePending] = useState(false);
  const [companyId, setCompanyId] = useState();

  const router = useRouter();

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

  // Preview URL for the newly selected file
  const filePreviewUrl = useMemo(() => {
    if (logoFile) {
      return URL.createObjectURL(logoFile);
    }
    return null;
  }, [logoFile]);

  // --- Initial Data Load and Form Reset ---
  useEffect(() => {
    (async () => {
      if (!user) return;

      const { data: existingValues } = await supabase
        .from("company_info")
        .select(
          "id, name, description, website, industry, headquarters, company_size, tag_line, logo_url"
        )
        .eq("user_id", user.id)
        .single();

      if (existingValues) {
        setCompanyId(existingValues.id);
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
  }, [user, form]);

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

  // --- Client-Side Delete (Defers action until submit) ---
  const handleDelete = () => {
    setLogoFile(null); // Clear new file selection
    if (existingLogoUrl) {
      setExistingLogoUrl(null); // Clear displayed existing logo
      setDeletePending(true); // Mark existing logo for deletion on submit
    }
    // toast.success("Logo marked for deletion on save.");
  };

  // --- Form Submission ---
  const onSubmit = async (values: FormValues) => {
    if (!user) {
      toast.error("User not authenticated.");
      return;
    }

    setLoading(true);
    let finalLogoUrl = existingLogoUrl;

    try {
      // 1. Check for Pending Deletion (if delete button was clicked on existing logo)
      if (deletePending && existingLogoUrl) {
        await handleDeleteStorage();
        finalLogoUrl = null;
      }

      // 2. Handle New File Upload
      if (logoFile) {
        finalLogoUrl = await handleUploadStorage(logoFile);
      }

      // 3. Update embedding
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

      // 4. Save company info (with the final logo URL status)
      const { error } = await supabase.from("company_info").upsert(
        {
          user_id: user.id,
          ...values,
          logo_url: finalLogoUrl, // Use the final URL status (new URL or null)
          filled: true,
        },
        { onConflict: "user_id" }
      );

      if (error) throw error;

      const { error: updateAppMetaError } = await updateUserAppMetadata(
        user.id,
        {
          type: "company",
          onboarding_complete: true,
        }
      );

      if (updateAppMetaError) throw new Error(updateAppMetaError);

      setLogoFile(null);
      setDeletePending(false);
      setExistingLogoUrl(finalLogoUrl);

      toast.success("Information Saved Successfully!");
      router.push("/company");
    } catch {
      // console.error("API call failed:", error);
      toast.error(
        "An error occurred while saving information. Please try again."
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

  // Determine which URL to show in the preview
  const currentLogoDisplayUrl = filePreviewUrl || existingLogoUrl;

  return (
    <div className="flex flex-col gap-10 items-center justify-center p-4 mb-20">
      <div className="flex flex-col gap-5 max-w-2xl w-full">
        <p className="text-6xl font-bold  ">Let&apos;s Hire, quickly.</p>
        <Link
          href={`/companies/${companyId}`}
          className="underline flex items-center gap-1"
          target="_blank"
          rel="noopener noreferrer"
        >
          View Public Profile <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="w-full space-y-6 max-w-2xl"
        >
          {/* Company Name */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Company Name <span className="text-red-500">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    className="bg-input"
                    placeholder="Acme Inc."
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Logo Upload Field */}
          <FormItem>
            <FormLabel>Company Logo</FormLabel>
            <div className="flex items-center space-x-4">
              {/* Logo Preview */}
              {currentLogoDisplayUrl && (
                <div className="relative h-20 w-20 flex-shrink-0 rounded-lg border p-1">
                  <img
                    src={currentLogoDisplayUrl}
                    alt="Company Logo Preview"
                    width={80}
                    height={80}
                    // objectFit="contain"
                    className="rounded-lg"
                  />
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
                </div>
              )}

              {/* File Input - Hidden if a file is already selected/exists and not marked for delete */}
              <div className="flex-grow">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    if (file) {
                      setLogoFile(file);
                      setDeletePending(false); // Cancel any pending delete
                    }
                  }}
                  className="bg-input h-10 p-2"
                  disabled={loading}
                  // Hide the input if we already have a logo and no new file is selected
                  // This is a common pattern to ensure the user clicks delete before re-uploading
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
            </div>
            <FormMessage />
          </FormItem>

          {/* Tagline */}
          <FormField
            control={form.control}
            name="tag_line"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tagline</FormLabel>
                <FormControl>
                  <Input
                    className="bg-input"
                    placeholder="Eg. Your Smartest Path to the perfect job"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Description (Required) */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Company Description <span className="text-red-500">*</span>
                </FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Tell us a little bit about your company..."
                    className="resize-y bg-input h-[200px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Website and Industry Grid (Required) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="website"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Company Website <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      className="bg-input"
                      placeholder="https://www.acme.com"
                      {...field}
                    />
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
                    Industry <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-input">
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

          {/* Headquarters and Size Grid (Required) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="headquarters"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Headquarters Location{" "}
                    <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <LocationSelector
                      value={field.value}
                      onChange={field.onChange}
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
                    Company Size <span className="text-red-500">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-input">
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

          {/* Submit Button */}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Complete Onboarding"
            )}
          </Button>
        </form>
      </Form>
      <p className="text-muted-foreground text-xs text-center mt-5">
        No need to panic, you can always update this information.
      </p>
    </div>
  );
}
