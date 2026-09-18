# Isolated PostgreSQL integration tests

Use a disposable PostgreSQL database named `nexus_audit_test` (or that name followed by an underscore and lowercase letters/digits), listening on `127.0.0.1`. Never point this suite at an application database. The suite creates fresh fixtures on every run and leaves them available for inspection; it does not delete existing rows.

Apply the repository migrations to that disposable database using an explicit process-local `DATABASE_URL`, then run:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://nexus_test@127.0.0.1:55439/nexus_audit_test'
npm run test:postgres
```

`TEST_DATABASE_URL` is test-only. The suite validates the host and database name before constructing PrismaService and overrides `DATABASE_URL` only within the test process. No application environment file needs changing.

Coverage includes record/custom-value/audit rollback, committed audit snapshots of uncommitted changes, real serialization retries, competing payment overpayment prevention, and receipt request-key uniqueness. This exercises the real Prisma extension and transaction helpers. A service integration scenario additionally covers concurrent FinanceService retries, changed-payload and deleted-receipt rejection, payment deletion reconciliation, successful recycle-bin restoration, and rollback of a restore that would overpay. The scenario also rejects voucher period changes with active or deleted receipt history. HTTP authentication/permission boundaries remain separate acceptance work.

The 2026-09-15 verification used a fresh PostgreSQL 16 cluster and applied all 18 migrations, including partial voucher status and receipt request keys. These migrations still require application-environment rollout separately.

The service scenario also verifies discount stacking on voucher creation, capping on update while retaining fines, and rejection of invalid fee-structure amounts.

People scenarios cover guardian/contact/link rollback, persisted relationship values, staff profile/access rollback, and student admission/enrollment/login rollback.
