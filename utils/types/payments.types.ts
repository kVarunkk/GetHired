import { BillingAddress, Customer } from "dodopayments/resources/index.mjs";
import { TPaymentStatus } from "../types";
import { createClient } from "@/lib/supabase/client";
import { QueryData } from "@supabase/supabase-js";

const supabase = createClient();

export type TWebhookPaymentDetails = {
  status: TPaymentStatus;
  credit_amount: number;
  payment_method: string;
  payment_id: string;
  total_amount: number;
  currency: string;
};

const paymentDetailQuery = supabase
  .from("payments")
  .select("*, price_plan(*)")
  .single();

const paymentsTableQuery = supabase
  .from("payments")
  .select(
    "id, created_at, status, total_amount, currency, credit_amount, price_plan(name)",
  )
  .eq("user_id", "")
  .single();

export type TPaymentIdRecord = QueryData<typeof paymentDetailQuery> & {
  customer: Customer | null;
  billing: BillingAddress | null;
};

export type TPaymentsTableRecord = QueryData<typeof paymentsTableQuery>;
