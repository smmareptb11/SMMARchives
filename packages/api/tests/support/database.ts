/**
 * The worker's test database, reached from here.
 *
 * Re-exported rather than rebuilt: both suites need the same migrated schema on
 * the same server, and two copies of that setup would drift — one learning a
 * new table the other keeps emptying by hand.
 */
export {
  closeDatabase,
  freshDatabase,
  withDatabase,
} from '../../../worker/tests/support/database.ts'
