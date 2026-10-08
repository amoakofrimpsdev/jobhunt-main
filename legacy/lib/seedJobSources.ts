import type { JobSource } from "./database";

export const defaultJobSources: JobSource[] = [
  {
    id: "example-careers",
    name: "Example Careers Page",
    url: "https://example.com/careers",
    source_type: "career_page",
    handle: null,
    active: true,
    last_scraped_at: null,
  },
  {
    id: "example-twitter",
    name: "Example Twitter Jobs",
    url: "https://twitter.com/example",
    source_type: "twitter",
    handle: "example",
    active: true,
    last_scraped_at: null,
  },
];
