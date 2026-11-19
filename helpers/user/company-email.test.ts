import { describe, expect, it } from "vitest";
import { isGenericEmail } from "./company-email";

describe("isGenericEmail", () => {
  it.each(["a@gmail.com", "a@GoogleMail.com", " a@outlook.com ", "a@proton.me", "a@yahoo.co.in", "a@icloud.com", "a@mailinator.com"])(
    "refuses the personal address %s",
    (email) => expect(isGenericEmail(email)).toBe(true),
  );

  it.each(["hr@acme.com", "a@gmail.acme.com", "a@mygmail.com", "not-an-email"])("allows %s", (email) =>
    expect(isGenericEmail(email)).toBe(false),
  );
});
