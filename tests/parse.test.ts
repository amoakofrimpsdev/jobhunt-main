// What Jobhunt reads out of a posting's words: sponsorship, clearance and citizenship statements, level, years, pay,
// work model and country. These rules decide what gets hidden from someone who needs a visa, so they are pinned.
import assert from "node:assert/strict";
import { test } from "node:test";
import { countryOf, levelOfTitle, payFromText, workModelOf, yearsRequired } from "../src/lib/parse/facts";
import { parseStatements, visaBlocker } from "../src/lib/parse/statements";
import { htmlToText, sanitizeHtml } from "../src/lib/text";

const blocker = (title: string, text: string) => visaBlocker(title, text, parseStatements(text))?.reason ?? null;

test("a posting that will not sponsor is a blocker", () => {
  assert.equal(parseStatements("We are unable to sponsor visas for this role.").sponsorship, "no");
  assert.equal(blocker("Data Analyst", "Applicants must be authorized to work without the need for sponsorship now or in the future."), "no_sponsorship");
});

test("a posting that offers sponsorship is not a blocker", () => {
  const s = parseStatements("Visa sponsorship is available for qualified candidates.");
  assert.equal(s.sponsorship, "yes");
  assert.equal(blocker("Engineer", "Visa sponsorship is available for qualified candidates."), null);
});

test("equal-opportunity boilerplate is not a statement about the job", () => {
  const text = "We consider all applicants without regard to race, citizenship, or veteran status.";
  assert.equal(parseStatements(text).usCitizenOnly, null);
  assert.equal(blocker("Engineer", text), null);
});

test("citizenship and clearance requirements are blockers, preferences are not", () => {
  assert.equal(blocker("Engineer", "U.S. citizenship is required for this position."), "citizenship");
  assert.equal(blocker("Engineer", "Must have an active Top Secret clearance."), "clearance");
  assert.equal(blocker("Engineer", "An active security clearance is preferred but not required."), null);
  assert.equal(blocker("Engineer", "Open to US citizens or permanent residents."), null);
});

test("E-Verify participation is read both ways", () => {
  assert.equal(parseStatements("This employer participates in E-Verify.").eVerify, true);
  assert.equal(parseStatements("We do not participate in E-Verify.").eVerify, false);
  assert.equal(parseStatements("Great team, great snacks.").eVerify, null);
});

test("level comes from the title", () => {
  assert.equal(levelOfTitle("Senior Data Analyst"), "senior");
  assert.equal(levelOfTitle("Software Engineering Intern"), "intern");
  assert.equal(levelOfTitle("Staff Engineer"), "staff");
  assert.equal(levelOfTitle("Engineering Manager"), "manager");
  // A product manager is not a people manager.
  assert.equal(levelOfTitle("Product Manager"), null);
  assert.equal(levelOfTitle("Director of Finance"), "director");
  assert.equal(levelOfTitle("Data Analyst"), null);
});

test("years of experience asked for", () => {
  assert.equal(yearsRequired("5+ years of experience with SQL")?.min, 5);
  assert.equal(yearsRequired("Three years of professional experience in analytics")?.min, 3);
  assert.equal(yearsRequired("You must be at least 18 years old.")?.min ?? null, null);
  assert.equal(yearsRequired("We have served customers for over 50 years.")?.min ?? null, null);
});

test("pay stated in the text", () => {
  assert.deepEqual(payFromText("The range is $120,000 - $150,000 per year."), { min: 120000, max: 150000, currency: "USD", period: "year" });
  assert.deepEqual(payFromText("Pay: $28.50 to $34.00 per hour"), { min: 28.5, max: 34, currency: "USD", period: "hour" });
  assert.equal(payFromText("We raised $50,000,000 in funding."), null);
});

test("work model and country", () => {
  assert.equal(workModelOf("Remote", "", ""), "remote");
  assert.equal(workModelOf(null, "New York (Hybrid)", ""), "hybrid");
  assert.equal(countryOf("San Francisco, CA", null), "US");
  assert.equal(countryOf("London, UK", null), "other");
  assert.equal(countryOf("Remote", null), "unknown");
  assert.equal(countryOf("Toronto, Canada; Austin, TX", null), "US");
  assert.equal(countryOf("", "US"), "US");
});

test("posting HTML is reduced to plain structure", () => {
  const html = '<div onclick="x()"><p style="color:red">Hello <a href="http://evil">link</a></p><script>alert(1)</script><ul><li>One</li></ul></div>';
  const safe = sanitizeHtml(html);
  assert.ok(!/script|onclick|href|style/i.test(safe));
  assert.ok(safe.includes("<li>One</li>"));
  // Greenhouse sends its HTML entity-encoded.
  assert.ok(sanitizeHtml("&lt;p&gt;Hi&lt;/p&gt;").includes("<p>Hi</p>"));
  assert.equal(htmlToText("<p>A &amp; B</p><ul><li>C</li></ul>"), "A & B\n\n• C");
});
