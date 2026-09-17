"use strict";

const TABLES = [
  "access_requests",
  "attachments",
  "collections",
  "document_insights",
  "documents",
  "emojis",
  "events",
  "external_groups",
  "file_operations",
  "groups",
  "imports",
  "integrations",
  "notifications",
  "oauth_clients",
  "pins",
  "search_queries",
  "shares",
  "team_domains",
  "webhook_subscriptions",
];

// Row-level security policy shared by every team-scoped table. Enforcement is
// active only when the transaction is an authenticated API transaction, which
// sets `app.rls_forced = 'on'` and `app.team_id`. In that case a row is visible
// only when its team matches the acting tenant, unless the actor is a platform
// administrator. All other transactions (`app.rls_forced = 'off'`), such as
// background workers and anonymous/public requests, are exempt and remain
// governed by application-level authorization.
const POLICY_EXPRESSION = `
  NOT coalesce(current_setting('app.rls_forced', true), 'off')::boolean
  OR coalesce(current_setting('app.is_platform_admin', true), 'off')::boolean
  OR "teamId"::text = nullif(current_setting('app.team_id', true), '')
`;

module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;

    for (const table of TABLES) {
      await sql.query(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;\n` +
          `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;\n`
      );
      await sql.query(
        `DROP POLICY IF EXISTS tenant_isolation ON "${table}";`
      );
      await sql.query(
        `CREATE POLICY tenant_isolation ON "${table}"\n` +
          `  AS PERMISSIVE\n` +
          `  FOR ALL\n` +
          `  TO PUBLIC\n` +
          `  USING (${POLICY_EXPRESSION})\n` +
          `  WITH CHECK (${POLICY_EXPRESSION});`
      );
    }
  },

  async down(queryInterface) {
    const sql = queryInterface.sequelize;

    for (const table of TABLES) {
      await sql.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}";`);
      await sql.query(
        `ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;\n` +
          `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY;\n`
      );
    }
  },
};
