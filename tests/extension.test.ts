// The extension's form engine, the parts that need no page: what a question asks, and which option answers it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

type Engine = { keyFor(label: string, el: null): string; pick(options: string[], want: string): number; FORBIDDEN: RegExp; DEMOGRAPHIC: RegExp };
const sandbox: { JobhuntEngine?: Engine; globalThis?: unknown } = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync("extension/engine.js", "utf8"), sandbox as never);
const E = sandbox.JobhuntEngine!;

test("standard questions are recognised", () => {
  const cases: Record<string, string> = {
    "First Name": "first_name", "Last name *": "last_name", "Preferred First Name": "preferred_name", "Email": "email", "Phone": "phone",
    "LinkedIn Profile": "linkedin", "Full name": "full_name", "Please confirm your City and State": "city",
    "Will you now or in the future require Visa sponsorship (e.g., H-1B, TN)?": "needs_sponsorship",
    "Are you legally authorized to work in the U.S.?": "work_authorized", "Desired Salary or Hourly Rate": "salary", "What country are you based in?": "country",
  };
  for (const [label, key] of Object.entries(cases)) assert.equal(E.keyFor(label, null), key, label);
});

test("a long question that only mentions a standard word is its own question", () => {
  for (const label of [
    "Do you have a Bachelor of Pharmacy (B.S. Pharmacy) or Doctor of Pharmacy degree?",
    "Are you able to work a hybrid schedule at least 3 days per week in our New York City location?",
    "Do you have a disability or chronic condition that affects a major life activity in your discipline?",
  ]) assert.ok(E.keyFor(label, null).startsWith("q:"), label);
});

test("the right option is picked", () => {
  assert.equal(E.pick(["Select...", "Yes", "No"], "Yes"), 1);
  assert.equal(E.pick(["Yes, I am authorized to work", "No, I am not"], "No"), 1);
  assert.equal(E.pick(["Canada", "United States", "United Kingdom"], "United States"), 1);
  assert.equal(E.pick(["Bachelor's Degree", "Master's Degree"], "Masters degree"), 1);
  assert.equal(E.pick(["Red", "Green"], "Blue"), -1);
});

test("passwords, ID numbers and card details are never touched; demographic questions are marked", () => {
  for (const label of ["Password", "Social Security Number", "Date of birth", "Credit card number", "Driver's license"]) assert.ok(E.FORBIDDEN.test(label), label);
  for (const label of ["Gender", "Race / Ethnicity", "Veteran Status", "Do you have a disability?"]) assert.ok(E.DEMOGRAPHIC.test(label), label);
  assert.ok(!E.FORBIDDEN.test("First name") && !E.DEMOGRAPHIC.test("First name"));
});
