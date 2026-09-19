/** Rooms with this prefix are server-managed; clients may never join them. */
export const RESERVED_ROOM_PREFIX = 'platform:';

/** Room every connected SUPERADMIN is placed in by the server. */
export const SUPERADMIN_ROOM = `${RESERVED_ROOM_PREFIX}superadmin`;

/** Event emitted to SUPERADMIN_ROOM when a public inquiry is stored. */
export const INQUIRY_CREATED_EVENT = 'inquiry.created';
