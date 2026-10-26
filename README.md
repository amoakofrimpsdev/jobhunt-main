# Jobhunt

A job-search app that runs on your own computer. It reads employers' public job boards straight from the employer, ranks every job against your profile with rules you can read, flags the ones that will or will not sponsor a visa, picks the resume to send, fills the application, and tracks what you applied to.

No account, no database server, no AI key. Your profile, resumes, answers and tracker stay in one file on your machine.

![The Jobhunt feed](docs/images/feed.png)

## What it does

- **Reads jobs from the source.** About 2,500 employer boards on Greenhouse, Lever, Ashby, Workday, Workable, iCIMS, Oracle, JazzHR, BambooHR, SmartRecruiters, Personio and Teamtailor, plus the careers sites Amazon, Microsoft, Apple and Meta run themselves, and NHS Jobs. Every job links to the employer's own posting. No aggregators, and a posting that closes drops out on the next read.
- **United States, United Kingdom, or both.** One switch picks the countries the feed shows.
- **Ranks them for you.** A match percent built from role, skills and level, with the reason for every number. No model involved: the same profile and posting always give the same score.
- **Knows about work authorization.** Marks employers with recent H-1B filings, employers licensed to sponsor UK Skilled Worker visas, likely cap-exempt employers and E-Verify employers, and catches postings that ask for citizenship or a clearance or say they will not sponsor, quoting the posting's own words.
- **Picks the resume.** Keep several resumes (or point it at a folder). Each job shows which one fits best and why.
- **Finds the people.** One click opens a LinkedIn search for your connections at the company, friends of friends, recruiters, or the likely hiring manager.
- **Fills applications.** A Chrome extension fills the form, attaches the right resume, and remembers what you type so the next form needs less of you. It never presses Submit.
- **Writes with AI, if you want it.** Explain your fit, tailor a resume, draft a cover letter or an outreach message, using a model on your own machine, your own API key, or Claude Desktop.
- **Alerts you.** Save any search as an alert. New jobs that match show up on the Alerts page and as a notification on your Mac.
- **Tracks applications.** Saved, Applied, Interviewing, Offer, Rejected, with notes.
- **On your phone too.** Scan a code and use Jobhunt from your phone on the same Wi-Fi, from its home screen like an app.

## Quick start

You need Node 22.5 or later. SQLite is built into Node, so there is nothing else to install.

```bash
git clone https://github.com/amoakofrimpsdev/jobhunt-main.git
cd jobhunt-main
npm install
npm run dev
```

Open http://localhost:3000.

1. The first visit reads the employer boards, and jobs appear as each board answers. Greenhouse, Lever, Ashby and Workable boards are done in about ten minutes. Workday, iCIMS, Oracle, JazzHR and BambooHR need a request per posting, so their first read runs on in the background for a few hours.
2. Open **Profile**. Add a resume (PDF, Word or text) or type a target title and a few skills, then press **Save and score jobs**.
3. Go back to **Jobs**. The feed is now ranked for you.

The database is `.data/jobhunt.db`. Delete the `.data` folder to start over.

## The Mac app

```bash
npm run dmg
```

This builds `dist/Jobhunt_<version>_<arch>.dmg` and `dist/Jobhunt-extension_<version>.zip`. Open the disk image and drag Jobhunt to Applications.

- It needs Rust: `brew install rustup && rustup default stable`. The first build compiles the shell and takes a few minutes.
- The app is a small [Tauri](https://tauri.app) window around the same local server, with its own copy of Node, so the Mac it runs on needs nothing installed.
- Its data is in `~/Library/Application Support/com.danielfrimpong.jobhunt`, separate from the `.data` folder that `npm run dev` uses.
- The build is signed ad hoc, not with an Apple Developer ID. It opens normally on the Mac that built it. On another Mac, right-click the app and choose Open the first time.

## On your phone

Jobhunt runs on your computer; your phone can use it over Wi-Fi.

1. In **Settings**, under **Phone**, press **Switch on phone access**. If your computer asks whether Jobhunt may accept incoming connections, allow it (on Windows: private networks).
2. Point the phone's camera at the code and open the link. Or open the address shown in the phone's browser and type the six-letter code under the QR code (handy on Android, where the camera may open links in a preview that does not keep the pairing). If the page does not load at all, the phone is probably not on the same Wi-Fi: Android phones can quietly use mobile data, so turn it off while pairing.
3. Keep it like an app: on iPhone, Share then **Add to Home Screen**; on Android, the ⋮ menu then **Add to Home screen**.

On the phone you get the feed, job details, applying, the tracker, alerts, your profile and resumes, with a tab bar at the bottom. Settings, API keys, the browser extension and the Claude Desktop connector stay on the computer.

How it works (`src/lib/phone.ts`): the app itself still answers only on the computer's loopback address. Phone access opens a second small server on the local network (port 47610) that passes a paired phone's requests to the app. The code carries a secret; a phone that opens it gets a session cookie, and anything without one, anything not on a private network, and the computer-only pages are turned away. A change has to come from Jobhunt's own pages on the phone. **Make a new code** in Settings shuts out every paired phone. The connection is plain HTTP on your own network, so use it on a network you trust (home, not a café). The computer has to be on with Jobhunt open; the phone does no work of its own.

## The Chrome extension

1. Unzip `dist/Jobhunt-extension_<version>.zip`, or use the `extension/` folder as it is.
2. In Chrome open `chrome://extensions`, switch on Developer mode, press **Load unpacked** and choose the folder.
3. In Jobhunt open **Settings**, copy the pairing code, click the Jobhunt icon in Chrome and paste it.

On an application page a small pill appears ("Fill with Jobhunt · 71%"). Click it and the panel opens in Chrome's side panel, docked beside the page so it never covers the form. It stays open as you change tabs and move through an application's steps.

| In the panel | What it does |
|---|---|
| Job and match | The job this page is for and its score. If Jobhunt does not have the job, **Save job** adds it: the employer's whole board on Greenhouse, Lever or Ashby, or the single posting anywhere else. |
| Resume to attach | The best-fitting resume is preselected. Pick another and it tells you which one fits better. |
| Fill application | Fills every field it has an answer for, including custom dropdowns and the resume upload. Fields that already have a value are left alone. |
| Left for you | The questions it could not answer. Click one to jump to it on the page. |
| Recording | What you type by hand is saved and filled in the next time a form asks the same question. Long written answers are offered, not filled in by themselves, because they were written for one employer. |
| Mark applied | Moves the job to Applied in the tracker once you have submitted. |

What it will not do: press Submit, Next or Apply; tick a consent box; read or record passwords, ID numbers or card details. Voluntary demographic answers are remembered only if you tick the box.

On a Chrome older than version 116, which has no side panel, the same panel opens as a floating card on the page. On a site that is not in the built-in list, click the toolbar icon and choose **Use on this page**.

## AI (optional)

Nothing above uses a model. **Settings** offers three ways to add one. It runs only when you press a button under "Write with AI" on a job.

![AI settings](docs/images/settings.png)

| Option | Where it runs | What you need |
|---|---|---|
| A model on this computer | Ollama, LM Studio or any OpenAI-compatible server. Nothing leaves your machine. | The server running, with a model pulled |
| Your own API key | Anthropic or OpenAI, inside Jobhunt | A key. It is kept in the macOS Keychain, never in the database, never sent to the browser. |
| Claude Desktop | In Claude Desktop, on your Claude plan | Press **Add to Claude Desktop**, then restart Claude Desktop |

Every piece of writing starts from the resume in your library that fits the job best, and the model is told to use only what that resume says. The result is then checked: any skill or figure the resume does not back up is listed above the text for you to verify. Results are text you can edit and copy, and save to your Downloads folder as a PDF, a Word document or plain text. The PDF and Word files are one column of real text in a standard font, which applicant-tracking systems read reliably.

**The Claude Desktop round trip.** Pressing a button on a job opens Claude Desktop with the request. Claude reads the job and your resume through the Jobhunt connector (`mcp/jobhunt-mcp.cjs`, a small Model Context Protocol server), writes, and saves the result back onto the job. Jobhunt has to be open. You can also just ask Claude about your search: it can search the feed, read postings and resumes, and update the tracker.

## Your data

- **Everything is local.** One SQLite file holds the jobs, your profile, resumes, recorded answers and tracker. Set `JOBHUNT_DATA_DIR` to move it.
- **The repository holds no personal data.** `.data/` is ignored by git. Anyone who installs Jobhunt starts with an empty database.
- **Web pages cannot reach the app.** The local server answers only requests addressed to this computer and refuses changes that come from another site.
- **The extension needs a pairing code.** Without it the app gives the extension nothing. The extension stores only that code, and talks to one address: the app on `127.0.0.1`. **Make a new code** in Settings cuts off every extension holding the old one.
- **Network traffic.** Jobhunt contacts the three job-board providers, with no personal data in the request. It contacts an AI provider only if you choose one and press a button. It never contacts LinkedIn, Indeed or Glassdoor; the LinkedIn buttons are plain links your own browser opens.
- **The limit.** Other software running under your own account on your computer can read the database file, as with any local app.

## How it works

**Sources.** Greenhouse, Lever, Ashby, Workable, Personio and Teamtailor each publish a feed that returns an employer's whole board in one request. Workday, iCIMS, Oracle Recruiting, JazzHR, BambooHR and SmartRecruiters do not: Jobhunt reads the list the employer's own careers page reads, then one request per posting for its text. Those boards are read incrementally. A posting whose text is already held is only marked as still listed; up to 60 new postings per board are read in full on each run, and the rest are saved from the list (title, place, date) and read in full on a later run. Every request carries a plain `jobhunt/<version>` User-Agent and no personal data, at most one a second to any one site. A posting missing from a complete list is closed; a board that fails, or whose list could not be read whole, closes nothing. The feed re-reads the boards when it is opened and the last full read is more than six hours old; the per-posting providers are read once a day.

**Collections.** A collection is a site that lists many employers: a venture firm's portfolio board, a Simplify list on GitHub, a quant job site. Jobhunt does not copy a collection's jobs; it follows the employers' own boards behind it. Eight ship in `data/collections.json`: Andreessen Horowitz, Techstars, Accel, Foundry, Simplify New Grad, Simplify Summer 2027 Internships, a set followed directly in jobleft, and Quant firms (the employers openquant.co and quantbase.fyi list, each checked against its own board feed). CampusMesh (campusmesh.com/jobs, jobs and internships for students) is followed through its public job list: each job there links to the employer's own posting, and Jobhunt follows that employer's board. Where the link is a posting on the employer's own website, the provider CampusMesh names and its company name are checked as the board instead. CampusMesh lists about 134,000 jobs from nearly 8,000 employers, so Jobhunt follows only the employers with a student or new-graduate job in the United States in a professional field (software, data, engineering, business, finance, product, research, design): about 2,600 boards. Once a week Jobhunt re-reads each collection's own site for employers it has added (`src/lib/collections.ts`): the sitemap, then one page per company it has not seen, looking for the employer's board; for a Simplify list, the list's data file. You can follow another collection by its address on the **Sources** page, check one now, switch one off, or remove it.

**Alerts.** An alert is the feed's current search and filters, saved. After each refresh (and every half minute during a long one) it is run over the jobs that are new since it last ran. The 40 best matches are kept as hits, shown on the **Alerts** page, and announced with a macOS notification. Hits are dropped after a month.

**Company careers sites.** Amazon, Microsoft, Apple and Meta do not use a job board provider, so each has a reader of its own and shows up on Sources as one board. Amazon's search returns full postings, so all of its United States jobs (about 13,000) arrive on the first read. Microsoft and Apple list their United States jobs and need a request per posting for the text; Meta's sitemap names its postings but gives no titles, so a Meta job appears once its page has been read. A run reads up to 600 new postings from one site and gives it at most twenty minutes, so Apple (about 4,400) fills in over about a week. Microsoft's site turns requests away when asked more than about once every three seconds, so it is read at that pace: about 200 full postings a run. Google is not read: its `robots.txt` disallows the job results pages.

**The UK.** The **Countries** switch (on the feed, and in your profile) shows United States, United Kingdom, both, or anywhere. A job that names no country (a bare "Remote", or no place at all) is shown with the United States, as before, but not in a UK-only feed, where it would mostly be American. Places are read from the posting: UK cities and towns, the nations, and postcodes, with "Cambridge, MA" and "Birmingham, AL" kept in the US. Choosing the UK switches on the UK sources, which a US-only feed does not read:

- *UK employers*: 102 UK employers' own boards (Monzo, Deliveroo, Starling, Wise, ASOS, Wayve, Faculty, Trainline, …), each checked on 2026-10-16 to have open UK jobs. Many US employers on the main list also hire in London; the switch shows those too.
- *NHS Jobs*: NHS trusts and practices post their own vacancies there, and it is where they are applied for. About 12,000 vacancies, listed 100 a request; each advert is read in full later, up to 600 a run, newest first.
- *Reed*, optional: with a free key from reed.co.uk/developers (Settings), Jobhunt searches Reed once a week for your target titles, opens one job per employer to see where applications go, and follows the employer's own board when it is on a provider Jobhunt reads. Reed's own listings and agency jobs are never added.

Civil Service Jobs, Totaljobs and CV-Library forbid automated reading in their `robots.txt`, and Find a Job turns automated requests away, so they are not read. Indeed and LinkedIn are not read either.

**Postings not read yet.** On the providers that need a request per posting, a job can be in the feed before its text has been read. Its card says "Requirements not read yet", because until then Jobhunt cannot know whether the posting rules out sponsorship, whatever the employer's H-1B record. Opening the job reads the posting there and then.

**Dates.** A card shows the board's own posting date when it gives one. Workday only says "Posted 30+ Days Ago" for older postings, which is kept as thirty days before the posting was first seen: the latest it can have gone up. A posting with no date that turns up on a board already being followed shows "Found 2h ago"; one that was simply there on the board's first read shows "Date not given" and is not treated as new.

**Job boards.** Every card carries the board you would apply through (Greenhouse, Workday, …), and the feed can be limited to chosen boards. "Quick apply" keeps Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Personio and Teamtailor, where applying is one page with no account to create.

**Facts.** Each posting is read once, when it arrives, by plain text rules (`src/lib/parse`): level, years of experience, work model, pay, country, and what it says about sponsorship, citizenship, clearance and E-Verify, each kept with the sentence it came from. A field the posting does not state is left empty, never guessed.

**Work authorization.** Signals for people on F-1 OPT, who need H-1B, or who need a UK Skilled Worker visa:

- *H-1B filer*: the employer has certified H-1B labor condition applications in recent US Department of Labor disclosure data (`data/h1b-sponsors.json`). This is the employer's history, not a promise for one role.
- *UK sponsor licence*: the employer is on the Home Office register of licensed sponsors for the Skilled Worker or Global Business Mobility routes (`data/uk-sponsors.json`, rebuilt with `npm run data:uk-sponsors`). Employers register under their legal name ("Monzo Bank Limited"), so names are matched with and without words like Bank, Group, UK or Payments; an employer known by a different trading name (Deliveroo is Roofoods Ltd) is missed. Shown on UK jobs only; the H-1B badge on US jobs only.
- *Cap-exempt likely*: the employer's name reads as a university, its hospital or a research nonprofit, which can file H-1B all year, outside the lottery. Confirm with the employer.
- *E-Verify*: the posting says the employer takes part, which a STEM OPT extension needs.

UK postings are read for their own wording too: "you must already have the right to work in the UK" and "not eligible for Skilled Worker sponsorship" rule sponsorship out, "Skilled Worker sponsorship is available" and the NHS's "applicants who require Skilled Worker sponsorship are welcome" offer it, "must be a British citizen" asks for citizenship, and SC or DV security clearance counts as a clearance. A plain "you must have the right to work in the UK" is not read as a refusal, just as "authorized to work in the US" is not.

With "I need visa sponsorship" on in your profile, postings that rule sponsorship out are held at 20% and hidden from the feed by default.

**Match.** `src/lib/match.ts` scores role (45%), skills (35%) and level (20%). A part the posting gives nothing to judge by counts as a middling 60, so a job known only by its title cannot reach the top. Recommended order adds points for a fresh posting (8 for today, 6 within three days, 4 within a week, 2 within two weeks) and takes them off one that has been up a while (6 after a month, 12 after two), so among equally good matches the newest come first and a two-month-old posting does not outrank this week's; it also spreads employers out, so one company with twenty openings does not fill the first page.

**Resumes.** The feed is ranked by your main profile. Opening a job scores it against each resume in the library with the same rules, and the panel says which to send and whether it beats the main profile. Two resumes for the same role that differ only in wording score the same; telling those apart needs a language model.

## Project layout

```
src/app/         the screens: Jobs (/), /alerts, /tracker, /profile, /sources, /settings
src/app/api/     local JSON routes the screens, the extension and the connector call
src/components/  Nav, JobCard, JobDrawer, JobWriting
src/lib/         store (SQLite), sources and sources-more (board readers), collections, parse,
                 taxonomy, match, ingest, alerts, resumes, export, ai, connector, ext, answers, people
data/            board directory, collections, H-1B table, skill and job-title taxonomies
extension/       the Chrome extension: engine.js (finds, fills and records fields),
                 content.js (the page side and its pill), view.js + sidepanel.js (the panel),
                 background.js (the only part that talks to the app)
mcp/             the Claude Desktop connector
desktop/         the Mac app's shell (Tauri) and its icon
scripts/         build-dmg.sh, and the scripts that rebuild data/ from a jobleft checkout
legacy/          the first version (Supabase, OpenAI, page scraping). Nothing imports it.
```

Useful commands:

| Command | What it does |
|---|---|
| `npm run dev` | The app at http://localhost:3000 |
| `npm run build` | A production build |
| `npm test` | The test suite (about a second; nothing touches your database or the network) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run dmg` | The Mac disk image and the extension zip, in `dist/` |

Built with Next.js 16, React 19, Tailwind CSS 4, Node's built-in SQLite and Tauri 2.

## Tests

```bash
npm test            # 67 tests, about two seconds
npm run test:perf   # the bottleneck report, about a minute
```

The tests use Node's own test runner. They need no network (a fake one answers every request the app makes, and records it) and each suite uses a throwaway database in a temp folder, so they never touch `.data/` or your Keychain.

| File | What it pins down |
|---|---|
| `parse.test.ts` | Reading a posting: sponsorship, citizenship, clearance and E-Verify statements (US and UK wording), level, years, pay in dollars and pounds, work model, country, and HTML made safe |
| `match.test.ts` | Skills and job-title taxonomies, the match score and its caps, company-name matching, H-1B and cap-exempt lookups, resume reading |
| `sources.test.ts` | Recognising a careers link on every provider, CampusMesh's student-job filter, NHS pay, LinkedIn search links, alert summaries, PDF and Word export, the phone door's rules |
| `store.test.ts` | The database: reading a board in, closing what disappears, posting dates, scoring, country and other filters, tracker, alerts, the extension's pairing code |
| `extension.test.ts` | The extension's form engine: what a question asks and which option answers it |
| `upgrade.test.ts` | The one-time database upgrade run before the app starts: the same statements as the app's, and an interrupted database brought up to date |
| `system.test.ts` | The system end to end without the internet: each provider's reader (Greenhouse, Lever, Ashby, Workable, Workday, Personio, Teamtailor, SmartRecruiters), a whole refresh (read, save, score, close), a failing board, a provider down for maintenance, a posting read when it is opened, the CampusMesh check, the Claude Desktop connector |
| `leaks.test.ts` | Data leaks. Your name, saved answers and API keys are filled with marker strings, every network path is run, and no marker may leave the computer: only Reed gets the job titles searched for, and its own key. Also: no API answer carries a saved key; the local API answers only this computer's pages (other hosts, other websites, DNS rebinding); the extension and the connector need their codes; the phone door lets in paired phones only and passes no cookie or referrer on; files holding secrets are private to you; a saved file is only ever shown from Downloads; posting HTML cannot run code |
| `plans.test.ts` | Bottlenecks visible without timing: every statement the feed, its counts, scoring and Sources run is checked with SQLite's query plan, and none may read job rows (which hold whole postings) except single jobs by id |
| `perf/bottlenecks.perf.ts` | Bottlenecks, timed: a 100,000-job database (set `JOBHUNT_PERF_JOBS` for more), the feed, search, filters, opening a job, Sources, rescoring everything and saving a board, each against a budget, with the longest time the app stops answering. Prints a report |

The fast tests run on GitHub for every push (`.github/workflows/test.yml`). The live job sites and the extension inside a real browser are not covered by automated tests.

## Status

This is a personal project, built quickly. What has and has not been exercised beyond the tests above:

| Part | State |
|---|---|
| Reading boards, scoring, filters, tracker, resume library | Exercised against live boards on all nine providers |
| Collections re-read, alerts, PDF and Word export | Each exercised once against live data; exports opened and read back |
| Extension on Greenhouse | Filled a live application form, including custom dropdowns and the resume upload, with nothing submitted |
| Extension on Ashby | Text fields filled on a live form; fixes made afterwards were not re-run there |
| Extension on Lever, Workday and others | Not tested. Workday needs a sign-in to reach the form. |
| Extension as an installed Chrome extension | Tested by injecting its scripts into live pages, not by loading it into Chrome |
| AI with a local model | Tested against a stand-in server, not a real model |
| AI with an Anthropic or OpenAI key | Key storage and error handling tested; no real request made |
| Claude Desktop connector | Tested over its protocol end to end; opening Claude Desktop with the request filled in is untested |
| Mac app | Built and run on Apple silicon only |

Not built yet:

- Readers for the EU hosts of Greenhouse and Lever, and for Personio, Recruitee and SmartRecruiters.
- Importing LinkedIn connections.
- Windows and Linux builds of the desktop app.

## Credits

The approach comes from [jobleft](https://github.com/Blueturboguy07/jobleft): read the employers' own boards instead of scraping pages through a model, keep everything local, score with rules that can explain themselves, and treat sponsorship as a first-class fact.

The H-1B figures come from the US Department of Labor's public LCA disclosure files. The UK sponsor register is published by the Home Office on GOV.UK under the Open Government Licence v3.0.

The interface follows the Clay design system from [awesome-design-md](https://github.com/VoltAgent/awesome-design-md): a cream canvas, near-black type and actions, and saturated single-colour cards. The tokens are in `src/app/globals.css`.

## License

[MIT](LICENSE)
