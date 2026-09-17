import { observer } from "mobx-react";
import { CloudIcon } from "outline-icons";
import * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { transparentize } from "polished";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Empty from "~/components/Empty";
import Heading from "~/components/Heading";
import Input from "~/components/Input";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import { client } from "~/utils/ApiClient";

type OpsTeam = {
  id: string;
  name: string;
  subdomain?: string | null;
  userCount?: number;
};

function Ops() {
  const { t } = useTranslation();
  const [teams, setTeams] = useState<OpsTeam[] | undefined>();
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const res = await client.post<{ data: OpsTeam[] }>("ops.teams.list", {});
    setTeams(res.data);
  };

  React.useEffect(() => {
    void load();
  }, []);

  const handleCreate = async () => {
    if (!name) {
      return;
    }
    setCreating(true);
    try {
      await client.post("ops.teams.create", { name, subdomain });
      toast.success(t("Tenant created"));
      setName("");
      setSubdomain("");
      await load();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Scene
      title={t("Platform console")}
      icon={<CloudIcon color="currentColor" />}
      actions={
        <Button onClick={handleCreate} disabled={creating || !name}>
          {creating ? t("Creating…") : t("Create tenant")}
        </Button>
      }
    >
      <Heading>{t("Platform operations")}</Heading>
      <Text type="secondary">
        {t(
          "Manage all company tenants. Each tenant is an isolated workspace with its own subdomain."
        )}
      </Text>

      <Row>
        <Input
          label={t("Tenant name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Acme Corp"
        />
        <Input
          label={t("Subdomain")}
          value={subdomain}
          onChange={(event) => setSubdomain(event.target.value)}
          placeholder="e.g. acme"
        />
      </Row>

      <Heading as="h2">{t("Tenants")}</Heading>
      {teams && teams.length === 0 ? (
        <Empty>{t("No tenants yet")}</Empty>
      ) : (
        <Table role="table">
          <thead>
            <tr role="row">
              <th role="columnheader">{t("Name")}</th>
              <th role="columnheader">{t("Subdomain")}</th>
              <th role="columnheader">{t("Users")}</th>
            </tr>
          </thead>
          <tbody>
            {(teams ?? []).map((team) => (
              <tr key={team.id} role="row">
                <td role="cell">{team.name}</td>
                <td role="cell">{team.subdomain ?? t("—")}</td>
                <td role="cell">{team.userCount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Scene>
  );
}

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 24px;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;

  th {
    text-align: left;
    font-weight: 500;
    color: ${s("text")};
    border-bottom: 1px solid ${s("divider")};
    padding: 8px 6px;
  }

  td {
    padding: 10px 6px;
    border-bottom: 1px solid
      ${(props) => transparentize(0.3, props.theme.divider)};
    color: ${s("text")};
  }

  tr:last-child td {
    border-bottom: 0;
  }
`;

export default observer(Ops);
