/* ============================================================
   Covers — global search index
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
  { id: "p-darie-roberts", name: "Darie Roberts", role: "Bartender" },
  { id: "p-leanne-vidal", name: "Leanne Vidal", role: "Wait Staff" },
  { id: "p-mitch-egan", name: "Mitch Egan", role: "Gaming Attendant" },
  { id: "p-tahlia-johnson", name: "Tahlia Johnson", role: "Barback" },
  { id: "p-aaron-patel", name: "Aaron Patel", role: "Bartender" },
  { id: "p-sophie-nguyen", name: "Sophie Nguyen", role: "Venue Manager" },
  { id: "p-jake-morrison", name: "Jake Morrison", role: "Bartender" },
  { id: "p-hassan-ali", name: "Hassan Ali", role: "Kitchen Hand" },
  { id: "p-james-carter", name: "James Carter", role: "Bar Supervisor" },
  { id: "p-sarah-lee", name: "Sarah Lee", role: "Events Manager" },
  { id: "p-emma-wright", name: "Emma Wright", role: "Operations Lead" },
  { id: "p-alex-nguyen", name: "Alex Nguyen", role: "Sous Chef" },
  { id: "p-mia-anderson", name: "Mia Anderson", role: "Glassy" },
  { id: "p-jordan-lee", name: "Jordan Lee", role: "Wait Staff" },
  { id: "p-taylor-wilson", name: "Taylor Wilson", role: "Barista" },
  { id: "p-casey-brown", name: "Casey Brown", role: "Kitchen Hand" },
  { id: "p-michael-tan", name: "Michael Tan", role: "Barback" },
  { id: "p-josh-williams", name: "Josh Williams", role: "Duty Manager" },
];

const JOBS: RawJob[] = [
  { id: "j-brightwater-friday-live", name: "Brightwater Friday Live", kind: "Venue event" },
  { id: "j-northside-long-lunch", name: "Northside Long Lunch", kind: "Venue event" },
  { id: "j-werribee-park-wedding", name: "Werribee Park Wedding", kind: "Off-premise catering" },
  { id: "j-docklands-corporate-lunch", name: "Docklands Corporate Lunch", kind: "Off-premise catering" },
  { id: "j-quayside-product-launch", name: "Quayside Product Launch", kind: "Off-premise catering" },
  { id: "j-brightwater-gaming", name: "Brightwater Gaming Floor", kind: "Venue event" },
  { id: "j-summer-function-pool", name: "Summer Function Pool", kind: "Venue event" },
  { id: "j-spring-carnival-marquee", name: "Spring Carnival Marquee", kind: "Off-premise catering" },
];

const SITES: RawSite[] = [
  { id: "s-brightwater", name: "Brightwater Hotel", region: "Victoria" },
  { id: "s-northside", name: "Northside Tavern", region: "Victoria" },
  { id: "s-brightwater-gaming", name: "Brightwater Gaming Room", region: "Victoria" },
  { id: "s-quayside", name: "Quayside Bar & Kitchen", region: "Victoria" },
  { id: "s-werribee-wedding", name: "Werribee Park Wedding", region: "Off-premise" },
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
    href: "/events",
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
