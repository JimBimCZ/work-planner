// Separate from lib/activity.ts, which imports lib/db and builds a pg pool at
// module scope: the drawer is a client component, and the caps must be
// reachable from it. The same reason lib/labels-limits.ts exists.
export const ACTIVITY_PER_BOARD = 500;

// The stored name's cap. Not a check constraint: a product limit, like the
// label and attachment caps.
export const ACTIVITY_SUBJECT_MAX = 120;
