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
import StickyActionBar from "@/components/StickyActionBar";
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
import { careersPath } from "@/helpers/careers/slug";
import { commonIndustries } from "@/utils/utils";
import { saveCompanyProfileAction } from "@/app/actions/company/save-company-profile";
import {
  companyProfileSchema,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
} from "@/helpers/companies/company-profile-schema";
import LocationSearchSelect from "./LocationSearchSelect";
import PageHeader from "./PageHeader";
import { COMPANY_HOME } from "@/helpers/user/home-path";

const formSchema = companyProfileSchema.extend({
  logo_file: z.any().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const supabase = createClient();

export default function CompanyOnboardingForm({
  user,
  company,
  returnTo,
}: {
  user: User | null;
  /** The session user's company, through `company_members` (`getMyCompany`). */
  company: { id: string; canEditProfile: boolean } | null;
  /** Where to go once saved (a safe path, e.g. /company/agent); the dashboard by default. */
  returnTo?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [existingLogoUrl, setExistingLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [careers, setCareers] = useState<{ slug: string; published: boolean } | null>(null);

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
          "id, name, description, website, industry, headquarters, company_size, tag_line, logo_url, careers_slug, careers_published",
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
        if (existingValues.careers_slug) {
          setCareers({
            slug: existingValues.careers_slug,
            published: existingValues.careers_published,
          });
        }
      }
    })();
  }, [companyId, form]);

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

    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { logo_file, ...dbValues } = values;

      const formData = new FormData();
      formData.append("values", JSON.stringify(dbValues));
      if (logoFile) formData.append("logo", logoFile);
      if (deletePending) formData.append("removeLogo", "true");

      const result = await saveCompanyProfileAction(formData);
      if (!result.ok) throw new Error(result.error);

      setLogoFile(null);
      setDeletePending(false);
      setExistingLogoUrl(result.logoUrl);

      toast.success("Information Saved Successfully!");
      router.push(returnTo ?? COMPANY_HOME);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "An error occurred while saving information. Please try again.",
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
      <div className="flex flex-col w-full gap-6 p-4 mb-20">
        <PageHeader title="Company Profile" />
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
    <div className="flex flex-col w-full gap-6 p-4 mb-20">
      <PageHeader
        title="Company Profile"
        description={
          careers?.published ? (
            "How your company appears to candidates."
          ) : (
            <Link
              href="/company/settings/careers"
              className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-brand"
            >
              Publish your careers page to appear on the companies list
            </Link>
          )
        }
      />
      {careers?.published && (
        <Link
          href={careersPath(careers.slug)}
          className="text-sm font-medium underline underline-offset-4 flex w-fit items-center gap-1 transition-colors hover:text-brand"
          target="_blank"
          rel="noopener noreferrer"
        >
          View careers page <ExternalLink className="h-4 w-4" />
        </Link>
      )}
      {!canEdit && (
        <p className="max-w-2xl text-sm text-muted-foreground">
          Your role can&apos;t edit the company profile.
        </p>
      )}
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex w-full max-w-2xl flex-col gap-6"
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
                      accept={LOGO_TYPES.join(",")}
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        if (file && file.size > LOGO_MAX_BYTES) {
                          toast.error("The logo can be at most 900 KB.");
                          e.target.value = "";
                          return;
                        }
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

          </fieldset>
          {canEdit && (
            <StickyActionBar>
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
            </StickyActionBar>
          )}
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
