// import DodoPayments from "dodopayments";

// export const client = new DodoPayments({
//   bearerToken: process.env["DODO_PAYMENTS_API_KEY"], // This is the default and can be omitted
//   webhookKey: process.env.DODO_WEBHOOK_SECRET as string,
// });

// ✅ only runs when POST is actually called, never during build
import DodoPayments from "dodopayments"; // adjust import to match actual package

let dodoClient: DodoPayments | null = null;

export function getDodoClient() {
  if (!dodoClient) {
    dodoClient = new DodoPayments({
      bearerToken: process.env.DODO_PAYMENTS_API_KEY,
      webhookKey: process.env.DODO_WEBHOOK_SECRET as string,
    });
  }
  return dodoClient;
}
