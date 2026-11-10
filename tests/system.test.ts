// The system end to end, without the internet: every provider's reader against answers shaped like the real ones,
// then a whole refresh (read, save, score, close), a failing board, a provider down for maintenance, a posting read
// when it is opened, the CampusMesh check and the Claude Desktop connector, on a private database.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fakeNetwork, isolate, refreshDone, type Route } from "./helpers";

isolate("system");

type Store = typeof import("../src/lib/store");
type Ingest = typeof import("../src/lib/ingest");
let store: Store;
let ingest: Ingest;
let sources: typeof import("../src/lib/sources");

before(async () => {
  store = await import("../src/lib/store");
  ingest = await import("../src/lib/ingest");
  sources = await import("../src/lib/sources");
  // Only the boards a test adds are read: the shipped collections and starter boards are switched off.
  for (const c of store.listCollections()) store.setCollectionEnabled(c.id, false);
  store.db().prepare("UPDATE boards SET enabled = 0").run();
});

const greenhouse = (jobs: Array<{ id: number; title: string; location?: string; content?: string }>) => ({
  jobs: jobs.map((j) => ({
    id: j.id, title: j.title, absolute_url: `https://boards.greenhouse.io/acme/jobs/${j.id}`, location: { name: j.location ?? "Austin, TX" },
    content: j.content ?? "&lt;p&gt;Build data pipelines in Python and SQL. 2+ years of experience.&lt;/p&gt;", departments: [{ name: "Data" }], offices: [],
    first_published: "2026-10-01T12:00:00Z",
  })),
});

// ---------------------------------------------------------------- each provider's reader

const PROVIDERS: Route[] = [
  [/boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs/, () => greenhouse([{ id: 1, title: "Data Engineer" }])],
  [/api\.lever\.co\/v0\/postings\/acme/, () => [{
    id: "lv1", text: "Backend Engineer", hostedUrl: "https://jobs.lever.co/acme/lv1", applyUrl: "https://jobs.lever.co/acme/lv1/apply",
    categories: { location: "New York, NY", commitment: "Full-time", department: "Engineering" }, description: "<p>Go and Postgres.</p>",
    lists: [{ text: "Requirements", content: "<li>3+ years</li>" }], additional: "", workplaceType: "hybrid", createdAt: 1790000000000, country: "US",
    salaryRange: { min: 120000, max: 150000, currency: "USD", interval: "per-year-salary" },
  }]],
  [/api\.ashbyhq\.com\/posting-api\/job-board\/acme/, () => ({ jobs: [{
    id: "ab1", title: "Product Analyst", jobUrl: "https://jobs.ashbyhq.com/acme/ab1", applyUrl: "https://jobs.ashbyhq.com/acme/ab1/application",
    location: "Remote", descriptionHtml: "<p>SQL and dashboards.</p>", workplaceType: "Remote", employmentType: "FullTime", department: "Product",
    publishedAt: "2026-10-02T00:00:00Z", isListed: true,
  }] })],
  [/apply\.workable\.com\/api\/v1\/widget\/accounts\/acme/, () => ({ name: "Acme", jobs: [{
    shortcode: "WK1", title: "QA Engineer", url: "https://apply.workable.com/acme/j/WK1/", locations: [{ city: "London", country: "United Kingdom", countryCode: "GB" }],
    description: "<p>Testing.</p>", employment_type: "Full-time", department: "QA", published_on: "2026-10-03",
  }] })],
  [/acme\.wd5\.myworkdayjobs\.com\/wday\/cxs\/acme\/careers\/jobs$/, () => ({ total: 1, jobPostings: [{ title: "Financial Analyst", externalPath: "/job/Austin-TX/Financial-Analyst_R100", locationsText: "Austin, TX", postedOn: "Posted 3 Days Ago" }] })],
  [/acme\.wd5\.myworkdayjobs\.com\/wday\/cxs\/acme\/careers\/job\/Financial-Analyst_R100/, () => ({
    jobPostingInfo: { title: "Financial Analyst", location: "Austin, TX", jobDescription: "<p>Must be a U.S. citizen. Excel and SQL.</p>", timeType: "Full time", startDate: "2026-10-05", country: { alpha2Code: "US" } },
    hiringOrganization: { name: "Acme Corporation" },
  })],
  [/acme\.jobs\.personio\.de\/xml/, () => `<?xml version="1.0"?><workzag-jobs><position><id>77</id><subcompany>Acme GmbH</subcompany><office>Berlin</office><name>Werkstudent Data</name>
    <jobDescriptions><jobDescription><name>Tasks</name><value><![CDATA[<p>Python.</p>]]></value></jobDescription></jobDescriptions><employmentType>intern</employmentType><schedule>part-time</schedule><createdAt>2026-10-04T10:00:00+00:00</createdAt></position></workzag-jobs>`],
  [/acme\.teamtailor\.com\/jobs\.rss/, () => `<?xml version="1.0"?><rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><item><title>UX Designer</title>
    <description>&lt;p&gt;Figma.&lt;/p&gt;</description><pubDate>Fri, 10 Oct 2026 09:00:00 +0200</pubDate><link>https://acme.teamtailor.com/jobs/123-ux-designer</link><remoteStatus>hybrid</remoteStatus>
    <tt:locations><tt:location><tt:city>Manchester</tt:city><tt:country>United Kingdom</tt:country></tt:location></tt:locations><tt:department>Design</tt:department></item></channel></rss>`],
  [/api\.smartrecruiters\.com\/v1\/companies\/Acme\/postings\?/, () => ({ totalFound: 1, content: [{ id: "900", name: "Marketing Associate", location: { city: "Chicago", country: "us" }, releasedDate: "2026-10-06T00:00:00Z", company: { name: "Acme" }, typeOfEmployment: { label: "Full-time" } }] })],
  [/api\.smartrecruiters\.com\/v1\/companies\/Acme\/postings\/900/, () => ({ applyUrl: "https://jobs.smartrecruiters.com/Acme/900?apply", jobAd: { sections: { jobDescription: { title: "About", text: "<p>Campaigns.</p>" } } } })],
];

test("each provider's answer is read into postings", async () => {
  const net = fakeNetwork(PROVIDERS);
  try {
    const read = async (ats: Parameters<typeof sources.fetchBoard>[0], slug: string) => (await sources.fetchBoard(ats, slug, "Acme", new Set())).jobs;
    const gh = (await read("greenhouse", "acme"))[0];
    assert.equal(gh.title, "Data Engineer");
    assert.equal(gh.postedAt, "2026-10-01T12:00:00.000Z");
    const lv = (await read("lever", "acme"))[0];
    assert.deepEqual([lv.title, lv.workModel, lv.pay?.min, lv.pay?.max], ["Backend Engineer", "hybrid", 120000, 150000]);
    assert.match(lv.descriptionHtml, /Requirements/);
    const ab = (await read("ashby", "acme"))[0];
    assert.deepEqual([ab.title, ab.workModel, ab.employmentType], ["Product Analyst", "remote", "Full-time"]);
    const wk = (await read("workable", "acme"))[0];
    assert.deepEqual([wk.title, wk.countryCode], ["QA Engineer", "GB"]);
    const wd = (await read("workday", "acme.wd5.careers"))[0];
    assert.equal(wd.title, "Financial Analyst");
    assert.equal(wd.company, "Acme Corporation");
    assert.match(wd.descriptionHtml, /citizen/);
    const ps = (await read("personio", "acme"))[0];
    assert.deepEqual([ps.title, ps.employmentType, ps.location], ["Werkstudent Data", "Internship", "Berlin"]);
    const tt = (await read("teamtailor", "acme"))[0];
    assert.deepEqual([tt.title, tt.location, tt.workModel, tt.countryCode], ["UX Designer", "Manchester, United Kingdom", "hybrid", "GB"]);
    const sr = (await read("smartrecruiters", "Acme"))[0];
    assert.deepEqual([sr.title, sr.countryCode], ["Marketing Associate", "US"]);
    assert.match(sr.descriptionHtml, /Campaigns/);
    assert.deepEqual(net.unexpected, []);
  } finally {
    net.restore();
  }
});

// ---------------------------------------------------------------- a whole refresh

test("a refresh reads boards, saves and scores their jobs, and closes the ones that are gone", async () => {
  let listing = [{ id: 11, title: "Data Engineer" }, { id: 12, title: "Senior Data Engineer" }, { id: 13, title: "Recruiter" }];
  const net = fakeNetwork([[/boards-api\.greenhouse\.io\/v1\/boards\/refreshco\/jobs/, () => greenhouse(listing)], ...PROVIDERS]);
  try {
    store.saveProfile({ ...store.getProfile(), targetTitles: ["Data Engineer"], skills: ["python", "sql"], years: 2, region: "any" });
    const gh = store.addBoard("greenhouse", "refreshco", "Refreshco");
    const lv = store.addBoard("lever", "acme", "Acme");
    ingest.startRefresh([gh, lv]);
    await refreshDone(ingest.refreshStatus);
    const feed = store.feed({ q: "", limit: 50, sort: "score" }).jobs.filter((j) => j.company === "Refreshco" || j.company === "Acme");
    assert.equal(feed.length, 4);
    assert.ok(feed.every((j) => j.match !== null), "every job is scored");
    assert.equal(feed[0].title, "Data Engineer", "the best match comes first");
    // The next read no longer lists the recruiter job: it is closed. The others are unchanged and not written again.
    listing = listing.slice(0, 2);
    ingest.startRefresh([gh]);
    await refreshDone(ingest.refreshStatus);
    assert.ok(store.jobDetail("greenhouse:refreshco:13")!.closedAt, "the job that left the board is closed");
    assert.equal(store.jobDetail("greenhouse:refreshco:11")!.closedAt, null);
    assert.deepEqual(net.unexpected, []);
  } finally {
    net.restore();
  }
});

test("a board that fails closes nothing and says why", async () => {
  const net = fakeNetwork([[/boards-api\.greenhouse\.io\/v1\/boards\/flaky\/jobs/, () => new Response("busy", { status: 500 })]]);
  try {
    const id = store.addBoard("greenhouse", "flaky", "Flaky");
    store.saveBoardListing(id, [ingest.toJobRow({ id, ats: "greenhouse", slug: "flaky" }, { externalId: "1", url: "https://x/1", applyUrl: "", title: "Analyst", company: "Flaky", location: "Austin, TX", descriptionHtml: "<p>x</p>", workModel: null, employmentType: null, department: "", postedAt: null, countryCode: null, pay: null })]);
    ingest.startRefresh([id]);
    await refreshDone(ingest.refreshStatus);
    assert.equal(store.jobDetail("greenhouse:flaky:1")!.closedAt, null, "its job stays open");
    const board = store.listBoards().find((b) => b.id === id)!;
    assert.equal(board.lastOk, false);
    assert.match(board.lastError ?? "", /500/);
  } finally {
    net.restore();
  }
});

test("a provider down for maintenance is not asked again in the same run", async () => {
  const net = fakeNetwork([
    [/\.myworkdayjobs\.com\/wday\/cxs/, () => { const r = new Response("", { status: 403 }); Object.defineProperty(r, "url", { value: "https://community.workday.com/maintenance-page" }); return r; }],
  ]);
  try {
    const ids = Array.from({ length: 12 }, (_, i) => store.addBoard("workday", `co${i}.wd1.careers`, `Co ${i}`));
    ingest.startRefresh(ids);
    await refreshDone(ingest.refreshStatus);
    const asked = net.calls.filter((c) => c.url.includes("myworkdayjobs.com")).length;
    // Eight boards are read at a time: those already under way when the first answer came back are the only ones asked.
    assert.ok(asked <= 8, `only the boards already under way were asked (${asked} of 12)`);
    for (const b of store.listBoards().filter((x) => ids.includes(x.id))) assert.match(b.lastError ?? "", /maintenance/);
  } finally {
    net.restore();
  }
});

test("a job saved from its board's list alone is read in full when it is opened", async () => {
  const net = fakeNetwork(PROVIDERS);
  try {
    const id = store.addBoard("workday", "acme.wd5.careers", "Acme");
    const row = ingest.toJobRow({ id, ats: "workday", slug: "acme.wd5.careers" }, {
      externalId: "Financial-Analyst_R100", url: "https://acme.wd5.myworkdayjobs.com/careers/job/Austin-TX/Financial-Analyst_R100", applyUrl: "", title: "Financial Analyst",
      company: "Acme", location: "Austin, TX", descriptionHtml: "", workModel: null, employmentType: null, department: "", postedAt: null, countryCode: null, pay: null,
    });
    store.saveBoardListing(id, [row], false);
    assert.equal(store.feed({ q: "Financial Analyst", limit: 5 }).jobs.find((j) => j.id === row.id)?.unread, true);
    assert.equal(await ingest.readPosting(row.id), true);
    const job = store.jobDetail(row.id)!;
    assert.match(job.descriptionHtml, /citizen/);
    assert.equal(job.blocker, "citizenship", "what the posting says about visas is known once it is read");
  } finally {
    net.restore();
  }
});

// ---------------------------------------------------------------- careers sites (sitemap and job pages)

test("a careers site is read from its job sitemap and job pages, within its robots.txt", async () => {
  const { careersite, jobFromAddress, robotsRules } = await import("../src/lib/sources-sites");
  // Addresses: Radancy, Phenom, SuccessFactors and a GUID; a category page is not a job.
  assert.deepEqual(jobFromAddress("https://www.kaiserpermanentejobs.org/job/south-san-francisco/unit-assistant/641/1026016033"), { id: "1026016033", title: "Unit Assistant", place: "South San Francisco" });
  assert.deepEqual(jobFromAddress("https://jobs.sutterhealth.org/us/en/job/R-141956/Clinical-Nurse-II"), { id: "R-141956", title: "Clinical Nurse II", place: "" });
  assert.equal(jobFromAddress("https://careers.duke.edu/job/Durham-Postdoctoral-Associate-NC-27710/1344537600/")?.id, "1344537600");
  assert.equal(jobFromAddress("https://jobs.mdanderson.org/search/jobdetails/nurse-practitioner/31c84072-a979-480b-b97f-03f95ca6a4bb")?.title, "Nurse Practitioner");
  assert.equal(jobFromAddress("https://careers.yale.edu/us/en/c/temporary-positions-jobs"), null);
  const rules = robotsRules("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /search-jobs/\nDisallow: /*?qtvc=\nSitemap: https://care.example/sitemap_index.xml");
  assert.deepEqual(rules.sitemaps, ["https://care.example/sitemap_index.xml"]);
  assert.ok(rules.disallow.some((re) => re.test("/search-jobs/nurse")) && rules.disallow.some((re) => re.test("/job/x?qtvc=1")));
  assert.ok(!rules.disallow.some((re) => re.test("/job/austin/nurse/1/12345")), "the rules for other crawlers do not apply");

  const ld = (title: string) => `<script type="application/ld&#x2B;json">${JSON.stringify({ "@type": "JobPosting", title, description: "<p>Care for patients in the ICU. Must be a U.S. citizen.</p>", datePosted: "2026-10-20", employmentType: "FULL_TIME", jobLocation: { address: { addressLocality: "Austin", addressRegion: "TX", addressCountry: "US" } } })}</script>`;
  const net = fakeNetwork([
    [/care\.example\/robots\.txt/, () => "User-agent: *\nDisallow: /job/secret/\nSitemap: https://care.example/sitemap_index.xml"],
    [/care\.example\/sitemap_index\.xml/, () => `<sitemapindex><sitemap><loc>https://care.example/blog-sitemap.xml</loc></sitemap><sitemap><loc>https://care.example/jobs-sitemap.xml</loc></sitemap></sitemapindex>`],
    [/care\.example\/jobs-sitemap\.xml/, () => `<urlset><url><loc>https://care.example/job/austin/icu-nurse/10/50001</loc></url><url><loc>https://care.example/job/Dallas-Data-Analyst-TX-75201/50002/</loc></url>
      <url><loc>https://care.example/job/austin/closed-role/10/50003</loc></url><url><loc>https://care.example/job/secret/hidden-role/10/50004</loc></url><url><loc>https://care.example/about-us</loc></url>
      <url><loc>http://192.168.1.1/job/router/admin/10/50005</loc></url><url><loc>https://elsewhere.example/job/austin/nurse/10/50006</loc></url></urlset>`],
    [/care\.example\/blog-sitemap\.xml/, () => `<urlset><url><loc>https://care.example/blog/a-day-in-the-icu</loc></url></urlset>`],
    [/care\.example\/job\/austin\/icu-nurse/, () => `<html>${ld("ICU Nurse")}</html>`],
    [/care\.example\/job\/Dallas-Data-Analyst/, () => `<h1><span itemprop="title">Data Analyst</span></h1><meta itemprop="addressLocality" content="Dallas"><meta itemprop="addressRegion" content="TX">
      <meta itemprop="datePosted" content="2026-10-21"><div itemprop="description"><span class="jobdescription"><p>Build <span>dashboards</span> for our clinics with SQL and Tableau.</p>${"<p>More about the role and the team, the clinics and the patients we serve.</p>".repeat(4)}</span></div>`],
    [/care\.example\/job\/austin\/closed-role/, () => `<meta property="og:description" content="This job is no longer available.">`],
  ]);
  try {
    const l = await careersite("care.example", "Care Example", new Set());
    const by = new Map(l.jobs.map((j) => [j.externalId, j]));
    assert.deepEqual([...by.keys()].sort(), ["50001", "50002", "50003"], "the forbidden page, pages that are not jobs, and pages on other hosts are left out");
    assert.ok(!net.calls.some((c) => c.url.includes("/job/secret/")), "a page robots.txt forbids is never asked for");
    assert.equal(by.get("50001")!.title, "ICU Nurse");
    assert.equal(by.get("50001")!.location, "Austin, TX");
    assert.match(by.get("50001")!.descriptionHtml, /citizen/);
    assert.equal(by.get("50002")!.title, "Data Analyst");
    assert.equal(by.get("50002")!.location, "Dallas, TX");
    assert.match(by.get("50002")!.descriptionHtml, /dashboards<\/span> for our clinics/, "nested elements are kept whole");
    assert.equal(by.get("50003")!.descriptionHtml, "", "a closed posting's one-line summary is not taken for its text");
    assert.equal(by.get("50003")!.title, "Closed Role");
  } finally {
    net.restore();
  }
});

// ---------------------------------------------------------------- CampusMesh and the connector

test("the CampusMesh check follows only the employers it should", async () => {
  const cm = (j: { title: string; url: string; country?: string; source?: string; company?: string }) => ({
    title: j.title, primaryUrl: j.url, source: j.source ?? "greenhouse", company: { name: j.company ?? "x" }, location: { country: j.country ?? "US" }, experienceYearsMin: null, employmentType: null,
  });
  const net = fakeNetwork([
    [/api\.campusmesh\.com\/jobs-service\/jobs\/public\/list/, (url) => new URL(url).searchParams.get("offset") === "0" ? { data: { jobs: [
      cm({ title: "Software Engineering Intern", url: "https://boards.greenhouse.io/goodco/jobs/1" }),
      cm({ title: "Senior Staff Engineer", url: "https://boards.greenhouse.io/seniorco/jobs/2" }),
      cm({ title: "Data Analyst Intern", url: "https://boards.greenhouse.io/indiaco/jobs/3", country: "IN" }),
      cm({ title: "Patient Care Trainee", url: "https://boards.greenhouse.io/hospital/jobs/4" }),
      cm({ title: "New Grad Software Engineer", url: "https://www.ownsite.com/careers?gh_jid=5", company: "ownsite" }),
    ], totalJobCount: 5, hasNext: false } } : { data: { jobs: [], hasNext: false } }],
    [/boards-api\.greenhouse\.io\/v1\/boards\/ownsite\/jobs/, () => ({ jobs: [] })],
  ]);
  try {
    const { checkCollection } = await import("../src/lib/collections");
    // The shipped collection already follows the boards found when it was added: only what this check adds counts.
    const linked = () => new Set((store.db().prepare(`SELECT b.slug FROM board_collections bc JOIN boards b ON b.id = bc.board_id WHERE bc.collection_id = 'campusmesh.com'`).all() as Array<{ slug: string }>).map((r) => r.slug));
    const before = linked();
    await checkCollection({ id: "campusmesh.com", name: "CampusMesh", url: "https://campusmesh.com/jobs" });
    assert.deepEqual([...linked()].filter((s) => !before.has(s)).sort(), ["goodco", "ownsite"]);
  } finally {
    net.restore();
  }
});

test("the Claude Desktop connector's tools answer from the database", async () => {
  const { runTool } = await import("../src/lib/connector");
  assert.match(runTool("get_profile", {}), /Target titles: Data Engineer/);
  assert.match(runTool("search_jobs", { query: "Data Engineer", region: "any" }), /Data Engineer — Refreshco/);
  assert.match(runTool("get_job", { job_id: "greenhouse:refreshco:11" }), /Data Engineer/);
  assert.throws(() => runTool("delete_everything", {}));
});

after(() => {
  store?.db().close();
});
