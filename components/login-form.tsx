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
import { useProgress } from "react-transition-progress";
import GoogleAuthBtn from "./GoogleAuthBtn";

// Helper function to check if an email is a generic public domain
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

// Zod schema for form validation
const loginSchema = (isCompany: boolean) =>
  z.object({
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
  });

export function LoginForm({
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
    resolver: zodResolver(loginSchema(isCompany)),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const handleLogin = async (values: { email: string; password: string }) => {
    const supabase = createClient();
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (error) throw error;
      form.reset();
      startTransition(() => {
        startProgress();
        if (isCompany) {
          router.push("/company");
        } else {
          router.push(returnToPath ?? "/jobs");
        }
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
    <div className={cn("flex flex-col gap-4", className)} {...props}>
      <Card className="sm:w-[400px] w-full">
        <CardHeader>
          <CardTitle className="text-2xl">
            {isCompany && "Recruiter"} Login
          </CardTitle>
          <CardDescription>
            Enter your {isCompany && "company"} email below to login to your
            {isCompany && "hiring"} account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleLogin)}>
              <div className="flex flex-col gap-6">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <Label htmlFor="email">
                        {isCompany && "Company"} Email
                      </Label>
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
                      <div className="flex items-center">
                        <Label htmlFor="password">Password</Label>
                        <Link
                          href="/auth/forgot-password"
                          className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                        >
                          Forgot your password?
                        </Link>
                      </div>
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
                {form.formState.errors.root && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.root.message}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Logging in...
                    </>
                  ) : (
                    "Log in"
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
                Don&apos;t have an account?{" "}
                <Link
                  href={
                    isCompany
                      ? "/auth/sign-up?company=true"
                      : returnToPath
                        ? "/auth/sign-up?returnTo=" + returnToPath
                        : "/auth/sign-up"
                  }
                  className="underline underline-offset-4"
                >
                  Sign up
                </Link>
              </div>
              {!isCompany ? (
                <div className="mt-4 text-center text-xs">
                  Are you a company looking to hire candidates?{" "}
                  <Link
                    href={"/auth/login?company=true"}
                    className="underline underline-offset-4"
                  >
                    Login here
                  </Link>
                </div>
              ) : (
                <div className="mt-4 text-center text-xs">
                  Are you looking for jobs?{" "}
                  <Link
                    href={"/auth/login"}
                    className="underline underline-offset-4"
                  >
                    Login here
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
