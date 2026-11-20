// Calendar uses the shared PA tables. See docs/PA_TICHHOPV1_DATABASE_RUNBOOK.md.
// Dry-run by default; explicit --database and --apply are required for DDL.
require('./migrate-pa-compat.cjs');
