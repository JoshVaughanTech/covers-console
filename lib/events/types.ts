/* ============================================================
   Events — hospitality engagements. An event groups the shifts and
   roles for a venue or off-premise site over a date range.

   Shared rather than page-local: /events lists them and /schedule
   renders a catering site week from them, so one source keeps the
   two screens from disagreeing.
   ============================================================ */
export type EventStatus = "Active" | "Scheduled" | "On Hold" | "Completed";

export interface EventBooking {
  id: string;
  name: string;
  /** free-text location label, as printed on the booking */
  site: string;
  /**
   * The Idara site this engagement belongs to, when one corresponds. Absent for
   * a one-off off-premise engagement at a hired location — those have a place
   * but not a standing site, and the schedule only groups by real sites.
   */
  siteId?: string;
  client: string;
  status: EventStatus;
  start: string;
  end: string;
  filled: number;
  required: number;
  progress: number;
  crew: string[];
  requirements: string[];
}
