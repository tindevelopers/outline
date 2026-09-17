"use strict";

const TABLES = ["users", "authentications", "authentication_providers"];

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
