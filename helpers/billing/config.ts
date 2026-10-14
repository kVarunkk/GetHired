// Billing tunables (plan/feature-recruiter-billing-spec.md). The SQL functions
// use the same values: apply_subscription_event sets grace_until = now() + 7 days.

/** BL-REQ-013: days a past-due company keeps its plan. */
export const BL_GRACE_DAYS = 7;
/** BL-REQ-013: the days of the grace period that get a payment-failed email. */
export const BL_GRACE_EMAIL_DAYS = [0, 3, 6];
/** BL-REQ-004: purchased credits expire this many months after purchase. */
export const BL_CREDIT_EXPIRY_MONTHS = 12;
/** Credits expiring within this many days get one warning email. */
export const BL_CREDIT_EXPIRY_WARNING_DAYS = 30;
