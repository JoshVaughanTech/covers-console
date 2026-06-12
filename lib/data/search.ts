/* ============================================================
   FairShift — global search index
   A static, in-memory index of people, jobs and sites used by
   useGlobalSearch(). Results route to real console screens.
   ============================================================ */

export type SearchType = "person" | "job" | "site";

export interface SearchEntry {
  id: string;
  type: SearchType;
  title: string;
  sub: string;
  href: string;
  /** lowercase haystack of searchable terms */
  terms: string;
}

interface RawPerson {
  id: string;
  name: string;
  role: string;
}
interface RawJob {
  id: string;
  name: string;
  kind: string;
}
interface RawSite {
  id: string;
  name: string;
  region: string;
}

const PEOPLE: RawPerson[] = [
  { id: "p-darie-roberts", name: "Darie Roberts", role: "Carpenter" },
  { id: "p-leanne-vidal", name: "Leanne Vidal", role: "Electrician" },
  { id: "p-mitch-egan", name: "Mitch Egan", role: "Concreter" },
  { id: "p-tahlia-johnson", name: "Tahlia Johnson", role: "Labourer" },
  { id: "p-aaron-patel", name: "Aaron Patel", role: "Carpenter" },
  { id: "p-sophie-nguyen", name: "Sophie Nguyen", role: "Site Supervisor" },
  { id: "p-jake-morrison", name: "Jake Morrison", role: "Carpenter" },
  { id: "p-hassan-ali", name: "Hassan Ali", role: "Steel Fixer" },
  { id: "p-james-carter", name: "James Carter", role: "Crane Operator" },
  { id: "p-sarah-lee", name: "Sarah Lee", role: "Project Manager" },
  { id: "p-emma-wright", name: "Emma Wright", role: "Operations Lead" },
  { id: "p-alex-nguyen", name: "Alex Nguyen", role: "Plumber" },
  { id: "p-mia-anderson", name: "Mia Anderson", role: "Scaffolder" },
  { id: "p-jordan-lee", name: "Jordan Lee", role: "Electrician" },
  { id: "p-taylor-wilson", name: "Taylor Wilson", role: "Painter" },
  { id: "p-casey-brown", name: "Casey Brown", role: "Tiler" },
  { id: "p-michael-tan", name: "Michael Tan", role: "Labourer" },
  { id: "p-josh-williams", name: "Josh Williams", role: "Foreman" },
];

const JOBS: RawJob[] = [
  { id: "j-commercial-build-l2", name: "Commercial Build – Level 2", kind: "Construction" },
  { id: "j-warehouse-stage-1", name: "Warehouse – Stage 1", kind: "Construction" },
  { id: "j-aged-care-facility", name: "Aged Care Facility", kind: "Healthcare Fitout" },
  { id: "j-retail-fitout-34", name: "Retail Fitout – Store 34", kind: "Fitout" },
  { id: "j-civic-centre-upgrade", name: "Civic Centre Upgrade", kind: "Refurbishment" },
  { id: "j-brisbane-warehouse", name: "Brisbane Warehouse", kind: "Construction" },
  { id: "j-harbour-view-offices", name: "Harbour View Offices", kind: "Fitout" },
  { id: "j-airport-terminal", name: "Airport Terminal Upgrade", kind: "Refurbishment" },
];

const SITES: RawSite[] = [
  { id: "s-melbourne", name: "Melbourne Site", region: "Victoria" },
  { id: "s-port-melbourne", name: "Port Melbourne", region: "Victoria" },
  { id: "s-brisbane", name: "Brisbane Depot", region: "Queensland" },
  { id: "s-sydney", name: "Sydney CBD", region: "New South Wales" },
  { id: "s-perth", name: "Perth Yard", region: "Western Australia" },
];

export const SEARCH_INDEX: SearchEntry[] = [
  ...PEOPLE.map<SearchEntry>((p) => ({
    id: p.id,
    type: "person",
    title: p.name,
    sub: p.role,
    href: "/people",
    terms: `${p.name} ${p.role} person worker`.toLowerCase(),
  })),
  ...JOBS.map<SearchEntry>((j) => ({
    id: j.id,
    type: "job",
    title: j.name,
    sub: j.kind,
    href: "/jobs",
    terms: `${j.name} ${j.kind} job room project`.toLowerCase(),
  })),
  ...SITES.map<SearchEntry>((s) => ({
    id: s.id,
    type: "site",
    title: s.name,
    sub: s.region,
    href: "/attendance",
    terms: `${s.name} ${s.region} site location`.toLowerCase(),
  })),
];
