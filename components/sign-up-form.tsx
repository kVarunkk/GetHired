"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Loader2 } from "lucide-react";
import InfoTooltip from "./InfoTooltip";
import { useProgress } from "react-transition-progress";
import GoogleAuthBtn from "./GoogleAuthBtn";

const isGenericEmail = (email: string) => {
  const genericDomains = [
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "aol.com",
  ];
  const domain = email.split("@")[1];
  return genericDomains.includes(domain);
};

const signUpSchema = (isCompany: boolean) =>
  z
    .object({
      email: z
        .string()
        .email({ message: "Invalid email address." })
        .refine(
          (email) => {
            if (isCompany) {
              return !isGenericEmail(email);
            }
            return true;
          },
          {
            message: "Company email cannot be a generic public domain.",
          }
        ),
      password: z
        .string()
        .min(6, { message: "Password must be at least 6 characters." }),
      repeatPassword: z.string(),
    })
    .refine((data) => data.password === data.repeatPassword, {
      message: "Passwords do not match.",
      path: ["repeatPassword"],
    });

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isCompany = searchParams.get("company") === "true";
  const startProgress = useProgress();

  const returnToPath = searchParams.get("returnTo");

  const form = useForm({
    resolver: zodResolver(signUpSchema(isCompany)),
    defaultValues: {
      email: "",
      password: "",
      repeatPassword: "",
    },
  });

  const handleSignUp = async (values: {
    email: string;
    password: string;
    repeatPassword: string;
  }) => {
    const supabase = createClient();
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          emailRedirectTo: `${window.location.origin}/${
            isCompany ? "get-started?company=true" : "get-started"
          }`,
        },
      });
      if (error) throw error;
      if (!data.user) throw new Error("User not found");
      const dataToAdd = isCompany
        ? {
            user_id: data.user?.id,
          }
        : {
            user_id: data.user?.id,
            email: values.email,
            is_job_digest_active: true,
            is_promotion_active: true,
          };
      const { error: InfoError } = await supabase
        .from(isCompany ? "company_info" : "user_info")
        .insert(dataToAdd);
      if (InfoError) throw InfoError;
      form.reset();

      startTransition(() => {
        startProgress();

        router.push("/auth/sign-up-success");
      });
    } catch (error) {
      form.setError("root", {
        message: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="sm:w-[400px] w-full">
        <CardHeader>
          <CardTitle className="text-2xl">
            {isCompany && "Company"} Sign up
          </CardTitle>
          <CardDescription>
            Create a new {isCompany && "company"} account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSignUp)}>
              <div className="flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor="email"
                          className="flex items-center gap-2"
                        >
                          {isCompany && "Company"} Email
                        </Label>
                        {isCompany && (
                          <InfoTooltip
                            content={
                              <p className="text-xs">
                                Only Company Emails allowed
                              </p>
                            }
                          />
                        )}
                      </div>
                      <Input
                        id="email"
                        type="email"
                        placeholder="m@example.com"
                        required
                        className="bg-input"
                        {...field}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        required
                        className="bg-input"
                        {...field}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="repeatPassword"
                  render={({ field }) => (
                    <FormItem>
                      <Label htmlFor="repeat-password">Repeat Password</Label>
                      <Input
                        id="repeat-password"
                        type="password"
                        required
                        className="bg-input"
                        {...field}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {form.formState.errors.root && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.root.message}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating an account...
                    </>
                  ) : (
                    "Sign up"
                  )}
                </Button>
              </div>
              {!isCompany && (
                <div className="flex flex-col gap-5 mt-5">
                  <div className="text-center text-muted-foreground text-sm">
                    OR
                  </div>
                  <GoogleAuthBtn />
                </div>
              )}
              <div className="mt-4 text-center text-sm">
                Already have an account?{" "}
                <Link
                  href={
                    isCompany
                      ? "/auth/login?company=true"
                      : "/auth/login?returnTo=" + returnToPath
                  }
                  className="underline underline-offset-4"
                >
                  Login
                </Link>
              </div>

              {!isCompany ? (
                <div className="mt-4 text-center text-xs">
                  Are you a company looking to hire candidates?{" "}
                  <Link
                    href={"/auth/sign-up?company=true"}
                    className="underline underline-offset-4"
                  >
                    Sign up here
                  </Link>
                </div>
              ) : (
                <div className="mt-4 text-center text-xs">
                  Are you looking for jobs?{" "}
                  <Link
                    href={"/auth/sign-up"}
                    className="underline underline-offset-4"
                  >
                    Sign up here
                  </Link>
                </div>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
