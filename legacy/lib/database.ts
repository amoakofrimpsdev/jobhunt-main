export type JobSourceType = "career_page" | "twitter" | "search_query";

export type ExperienceLevel = "junior" | "mid" | "senior" | "unknown";
export type SponsorshipOffer = "yes" | "no" | "unknown";

export type JobSource = {
  id: string;
  name: string;
  url: string;
  source_type: JobSourceType;
  handle?: string | null;
  active: boolean;
  last_scraped_at: string | null;
};

export type JobListing = {
  id: string;
  source_id: string | null;
  title: string;
  company: string;
  description: string;
  location: string | null;
  requirements: string;
  sponsorship_offered: SponsorshipOffer;
  clearance_required: boolean;
  citizenship_required: boolean;
  experience_level: ExperienceLevel;
  date_posted: string | null;
  application_url: string;
  verified: boolean;
  raw_payload: unknown;
  created_at: string | null;
  updated_at: string | null;
};

export type ResumeProfile = {
  id: string;
  user_id: string;
  file_url: string | null;
  parsed_skills: string[];
  parsed_experience: Array<{
    role: string;
    company: string;
    start_date?: string;
    end_date?: string;
    summary?: string;
  }>;
  parsed_education: Array<{
    institution: string;
    degree?: string;
    years?: string;
    field?: string;
  }>;
  raw_text: string | null;
  created_at: string | null;
};

export type JobMatch = {
  id: string;
  user_id: string;
  job_id: string;
  score: number;
  summary: string;
  matched_skills: string[];
  missing_skills: string[];
  created_at: string | null;
};

export type Profile = {
  id: string;
  full_name: string | null;
  headline: string | null;
  created_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      job_sources: {
        Row: JobSource;
        Insert: Omit<JobSource, "id" | "last_scraped_at"> & {
          id?: string;
          last_scraped_at?: string | null;
        };
        Update: Partial<JobSource>;
      };
      job_listings: {
        Row: JobListing;
        Insert: Omit<JobListing, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: Partial<JobListing>;
      };
      resumes: {
        Row: ResumeProfile;
        Insert: Omit<ResumeProfile, "id" | "created_at"> & {
          id?: string;
          created_at?: string | null;
        };
        Update: Partial<ResumeProfile>;
      };
      job_matches: {
        Row: JobMatch;
        Insert: Omit<JobMatch, "id" | "created_at"> & {
          id?: string;
          created_at?: string | null;
        };
        Update: Partial<JobMatch>;
      };
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "id" | "created_at"> & {
          id?: string;
          created_at?: string | null;
        };
        Update: Partial<Profile>;
      };
    };
  };
};
