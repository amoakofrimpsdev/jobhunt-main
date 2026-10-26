// Telling which job board a link belongs to, the LinkedIn search links, alert summaries and the exported files.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { summarize } from "../src/lib/alerts";
import { toDocx, toPdf } from "../src/lib/export";
import { companyTerm, likelyManager, peopleSearches } from "../src/lib/people";
import { detectBoard } from "../src/lib/sources";
import { campusmeshFits, studentFriendly } from "../src/lib/collections";
import { forTests as uk } from "../src/lib/sources-uk";
import { forTests as phone } from "../src/lib/phone";

test("careers links are recognised on every provider", () => {
  const cases: Array<[string, string, string]> = [
    ["https://boards.greenhouse.io/stripe/jobs/123", "greenhouse", "stripe"],
    ["https://job-boards.greenhouse.io/judihealth/jobs/4747302008", "greenhouse", "judihealth"],
    ["https://boards.greenhouse.io/embed/job_board?for=acme", "greenhouse", "acme"],
    ["https://jobs.lever.co/palantir/5168e8fd/apply", "lever", "palantir"],
    ["https://jobs.ashbyhq.com/linear/d3bc1ced/application", "ashby", "linear"],
    ["https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA/Engineer_JR1", "workday", "nvidia.wd5.nvidiaexternalcareersite"],
    ["https://nasdaq.wd1.myworkdayjobs.com/Global_External_Site", "workday", "nasdaq.wd1.global_external_site"],
    ["https://westgold.wd103.myworkdayjobs.com/westgold/job/Perth-WA/Trainee_JR103451", "workday", "westgold.wd103.westgold"],
    ["https://wd5.myworkdaysite.com/recruiting/uw/UWHires/job/Seattle-WA/Scientist_REQ-1", "workday", "uw.wd5.uwhires"],
    ["https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/jobs", "workday", "acme.wd1.careers"],
    ["https://apply.workable.com/saalex/j/ABC123/", "workable", "saalex"],
    ["https://careers-nasco.icims.com/jobs/1234/analyst/job", "icims", "careers-nasco"],
    ["https://mujin.bamboohr.com/careers/55", "bamboohr", "mujin"],
    ["https://sigmadesign.applytojob.com/apply/AbCdEf12/Engineer", "jazzhr", "sigmadesign"],
    ["https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210", "oracle", "jpmc.fa.cx_1001"],
    ["https://jobs.smartrecruiters.com/Wise/744000155915039-assistant-company-secretary", "smartrecruiters", "Wise"],
    ["https://careers.smartrecruiters.com/Wise", "smartrecruiters", "Wise"],
    ["https://acme.jobs.personio.de/job/1834171?language=en", "personio", "acme"],
    ["https://acme.jobs.personio.com/", "personio", "acme"],
    ["https://acme.teamtailor.com/jobs/8118064-account-executive", "teamtailor", "acme"],
    ["https://www.jobs.nhs.uk/candidate/jobadvert/A2381-26-0018-SGP", "nhs", "all"],
    ["https://www.amazon.jobs/en/jobs/10574286/sr-embedded-sde", "amazon", "us"],
    ["https://apply.careers.microsoft.com/careers?domain=microsoft.com", "microsoft", "us"],
    ["https://jobs.apple.com/en-us/search?location=united-states-USA", "apple", "us"],
    ["https://www.metacareers.com/profile/job_details/3713685685437806/", "meta", "all"],
  ];
  for (const [url, ats, slug] of cases) assert.deepEqual(detectBoard(url), { ats, slug }, url);
});

test("CampusMesh jobs for students and new graduates are told apart", () => {
  for (const title of ["Software Engineering Intern", "Summer Internship 2027", "New Grad Data Analyst", "Graduate Trainee", "Entry-Level Accountant", "Junior Developer", "Engineer I", "Analyst 1, Risk", "Co-op Student", "Early Career Program", "Campus Hire - SWE"]) {
    assert.equal(studentFriendly({ title }), true, title);
  }
  for (const title of ["Senior Software Engineer", "Director of Finance", "Staff Engineer II", "Registered Nurse", "Associate Director"]) {
    assert.equal(studentFriendly({ title }), false, title);
  }
  assert.equal(studentFriendly({ title: "Data Analyst", experienceYearsMin: 0 }), true);
  assert.equal(studentFriendly({ title: "Data Analyst", experienceYearsMin: 5 }), false);
  // Followed: a student job in the US in a professional field.
  assert.equal(campusmeshFits({ title: "Software Engineering Intern", country: "US" }), true);
  assert.equal(campusmeshFits({ title: "Software Engineering Intern", country: "IN" }), false);
  assert.equal(campusmeshFits({ title: "Patient Care Trainee", country: "US" }), false);
});

test("other links are not boards", () => {
  for (const url of ["https://www.linkedin.com/jobs/view/1", "https://example.com/careers", "not a url at all", "https://www.bamboohr.com/pricing", "https://www.google.com/about/careers/applications/jobs/results/", "https://www.apple.com/careers/us/"]) {
    assert.equal(detectBoard(url), null, url);
  }
});

test("NHS pay and the XML pieces the UK readers use", () => {
  assert.deepEqual(uk.nhsPay("£32073.00 to £39043.00"), { min: 32073, max: 39043, currency: "GBP", period: "year" });
  assert.deepEqual(uk.nhsPay("£12.60 an hour"), { min: 12.6, max: 12.6, currency: "GBP", period: "hour" });
  assert.equal(uk.nhsPay("Negotiable"), null);
  assert.equal(uk.nhsPay("£350.00"), null);
  assert.equal(uk.tag("<a><b><![CDATA[<p>x</p>]]></b></a>", "b"), "<p>x</p>");
  assert.deepEqual(uk.tags("<l><o>A</o><o>B</o></l>", "o"), ["A", "B"]);
});

test("phone access lets in only private networks and keeps the computer's settings on the computer", () => {
  for (const ip of ["192.168.1.20", "10.0.0.5", "172.20.1.1", "100.64.5.91", "::ffff:192.168.0.3", "fe80::1"]) assert.equal(phone.isPrivate(ip), true, ip);
  for (const ip of ["8.8.8.8", "100.128.0.1", "172.32.0.1", "2001:4860::8888"]) assert.equal(phone.isPrivate(ip), false, ip);
  for (const [method, path] of [["GET", "/settings"], ["GET", "/api/answers"], ["POST", "/api/ext/save-job"], ["PUT", "/api/phone"], ["PUT", "/api/reed"], ["POST", "/api/claude"], ["PUT", "/api/ai"]]) {
    assert.equal(phone.computerOnly(method, path), true, `${method} ${path}`);
  }
  for (const [method, path] of [["GET", "/"], ["GET", "/api/jobs?limit=5"], ["POST", "/api/track"], ["POST", "/api/ai"], ["GET", "/tracker"]]) {
    assert.equal(phone.computerOnly(method, path), false, `${method} ${path}`);
  }
});

test("LinkedIn people searches are plain links to LinkedIn", () => {
  assert.equal(companyTerm("Acme, Inc."), "Acme");
  assert.equal(likelyManager("Senior Software Engineer", ""), "engineering manager");
  assert.equal(likelyManager("Data Analyst", ""), "analytics manager");
  const searches = peopleSearches({ company: "Wyzant, Inc.", title: "Software Engineer", department: "" });
  assert.deepEqual(searches.map((s) => s.key), ["first", "second", "recruiters", "manager"]);
  for (const s of searches) {
    const u = new URL(s.url);
    assert.equal(u.origin + u.pathname, "https://www.linkedin.com/search/results/people/");
    assert.ok(u.searchParams.get("keywords")!.startsWith('"Wyzant"'));
    assert.equal(u.searchParams.get("company"), "Wyzant");
    // Spaces are %20: LinkedIn reads a "+" as a plus sign.
    assert.ok(!s.url.includes("+"));
  }
  assert.equal(new URL(searches[0].url).searchParams.get("network"), '["F"]');
  // An internship also offers the campus recruiters.
  assert.ok(peopleSearches({ company: "Acme", title: "Data Science Intern", department: "" }).some((s) => s.key === "campus"));
});

test("an alert says what it looks for", () => {
  assert.equal(summarize(""), "Every new job");
  assert.equal(summarize("q=analyst&work=remote&h1b=1&minScore=80&ats=greenhouse,lever"), "“analyst” · remote · match 80% or more · on Greenhouse, Lever · visa sponsors");
});

const RESUME = `Jordan Testwell
Seattle, WA | jordan@example.com

EXPERIENCE
Data Analyst, Northwind Traders — 2022 – Present
- Built dashboards in Tableau; “free shipping” test raised order value.

SKILLS
SQL, Python`;

test("a PDF export is a well-formed PDF with the text in it", () => {
  const pdf = toPdf(RESUME, "resume", "Jordan Testwell - Tailored resume").toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  assert.ok(pdf.includes("(Jordan Testwell)"));
  assert.ok(pdf.includes("(EXPERIENCE)"));
  assert.ok(pdf.includes("/Helvetica-Bold"));
  // The cross-reference table points at the objects it lists.
  const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  assert.equal(pdf.slice(xref, xref + 4), "xref");
  const first = Number(/\n(\d{10}) 00000 n /.exec(pdf.slice(xref))![1]);
  assert.equal(pdf.slice(first, first + 7), "1 0 obj");
  // A long document runs onto more pages.
  const long = toPdf(`${RESUME}\n${"- another line of work that is long enough to matter\n".repeat(120)}`, "resume", "x").toString("latin1");
  assert.ok(Number(/\/Count (\d+)/.exec(long)![1]) > 1);
});

test("a Word export is a zip with the document inside", () => {
  const docx = toDocx(RESUME, "resume", "Jordan Testwell - Tailored resume");
  assert.equal(docx.readUInt32LE(0), 0x04034b50);
  // Walk the zip's index to word/document.xml and unpack it.
  const end = docx.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = docx.readUInt32LE(end + 16);
  let xml = "";
  for (let i = 0; i < docx.readUInt16LE(end + 10); i++) {
    const nameLength = docx.readUInt16LE(at + 28);
    const name = docx.toString("utf8", at + 46, at + 46 + nameLength);
    const local = docx.readUInt32LE(at + 42);
    if (name === "word/document.xml") {
      const start = local + 30 + docx.readUInt16LE(local + 26) + docx.readUInt16LE(local + 28);
      xml = inflateRawSync(docx.subarray(start, start + docx.readUInt32LE(at + 20))).toString("utf8");
    }
    at += 46 + nameLength + docx.readUInt16LE(at + 30) + docx.readUInt16LE(at + 32);
  }
  assert.ok(xml.includes("Jordan Testwell"));
  assert.ok(xml.includes("Built dashboards in Tableau"));
  assert.ok(xml.includes("<w:b/>"));
});
