// Separate from lib/labels.ts, which imports lib/db and builds a pg pool at
// module scope: the filter popover is a client component and needs the name
// cap, so the constants live in a module that imports nothing.
export const LABEL_NAME_MAX = 32;

// Not a check constraint: a tunable product limit, not an invariant. It is
// load-bearing rather than cosmetic — a card's label ids travel in a realtime
// payload, and 50 ids at 36 bytes stays far under PAYLOAD_CEILING.
export const LABELS_PER_BOARD = 50;
