import { observer } from "mobx-react";
import {
  CloudIcon,
  EditIcon,
  TrashIcon,
  CheckmarkIcon,
  CloseIcon,
} from "outline-icons";
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
import NudeButton from "~/components/NudeButton";
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
  const [adminEmail, setAdminEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<
    Record<string, { name: string; subdomain: string }>
  >({});
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await client.post<{ data: OpsTeam[] }>("/ops.teams.list", {});
      setTeams(res?.data ?? []);
    } catch {
      toast.error(t("Failed to load tenants"));
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!name) {
      return;
    }
    setCreating(true);
    try {
      await client.post("/ops.teams.create", {
        name,
        subdomain,
        adminEmail: adminEmail || undefined,
      });
      toast.success(
        adminEmail
          ? t("Tenant created — invite sent to {{email}}", {
              email: adminEmail,
            })
          : t("Tenant created")
      );
      setName("");
      setSubdomain("");
      setAdminEmail("");
      await load();
    } catch {
      toast.error(t("Failed to create tenant"));
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (team: OpsTeam) =>
    setEditing((prev) => ({
      ...prev,
      [team.id]: { name: team.name, subdomain: team.subdomain ?? "" },
    }));

  const cancelEdit = (id: string) =>
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const handleSave = async (teamId: string) => {
    const draft = editing[teamId];
    if (!draft) {
      return;
    }
    setSaving(teamId);
    try {
      await client.post("/ops.teams.update", {
        id: teamId,
        name: draft.name || undefined,
        subdomain: draft.subdomain || undefined,
      });
      toast.success(t("Tenant updated"));
      cancelEdit(teamId);
      await load();
    } catch {
      toast.error(t("Failed to update tenant"));
    } finally {
      setSaving(null);
    }
  };

  /**
   * Enter a tenant workspace as its admin. The server provisions an admin
   * account for the operator in the target team and returns a single-use
   * sign-in URL, which is opened in a new tab on that team's subdomain.
   */
  const handleEnter = async (team: OpsTeam) => {
    setEntering(team.id);
    try {
      const res = await client.post<{ data: { url: string } }>(
        "/ops.teams.impersonate",
        { id: team.id }
      );
      if (res?.data?.url) {
        window.open(res.data.url, "_blank");
      }
    } catch {
      toast.error(t("Failed to enter workspace"));
    } finally {
      setEntering(null);
    }
  };

  const handleDelete = async (team: OpsTeam) => {
    if (
      !window.confirm(
        t('Delete workspace "{{name}}"? This cannot be undone.', {
          name: team.name,
        })
      )
    ) {
      return;
    }
    setDeleting(team.id);
    try {
      await client.post("/ops.teams.delete", { id: team.id });
      toast.success(t("Tenant deleted"));
      await load();
    } catch {
      toast.error(t("Failed to delete tenant"));
    } finally {
      setDeleting(null);
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
          onChange={(e) => {
            const val = e.target.value;
            setName(val);
            setSubdomain(
              val
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "-")
                .replace(/-+/g, "-")
                .replace(/^-|-$/g, "")
            );
          }}
          placeholder="e.g. Acme Corp"
        />
        <Input
          label={t("Subdomain")}
          value={subdomain}
          onChange={(e) => setSubdomain(e.target.value)}
          placeholder="e.g. acme"
        />
        <Input
          label={t("Admin email (optional)")}
          type="email"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
          placeholder="e.g. admin@acme.com"
        />
      </Row>

      <Heading as="h2">{t("Tenants")}</Heading>
      {teams && teams.length === 0 ? (
        <Empty>{t("No tenants yet")}</Empty>
      ) : (
        <Table role="table">
          <thead>
            <tr>
              <th>{t("Name")}</th>
              <th>{t("Subdomain")}</th>
              <th>{t("Users")}</th>
              <th style={{ width: 180 }} />
            </tr>
          </thead>
          <tbody>
            {(teams ?? []).map((team) => {
              const draft = editing[team.id];
              return (
                <tr key={team.id}>
                  <td>
                    {draft ? (
                      <InlineInput
                        value={draft.name}
                        onChange={(e) =>
                          setEditing((p) => ({
                            ...p,
                            [team.id]: { ...p[team.id], name: e.target.value },
                          }))
                        }
                      />
                    ) : (
                      team.name
                    )}
                  </td>
                  <td>
                    {draft ? (
                      <InlineInput
                        value={draft.subdomain}
                        onChange={(e) =>
                          setEditing((p) => ({
                            ...p,
                            [team.id]: {
                              ...p[team.id],
                              subdomain: e.target.value,
                            },
                          }))
                        }
                      />
                    ) : (
                      (team.subdomain ?? "—")
                    )}
                  </td>
                  <td>{team.userCount ?? 0}</td>
                  <td>
                    <Actions>
                      {!draft && (
                        <Button
                          neutral
                          onClick={() => void handleEnter(team)}
                          disabled={entering === team.id}
                        >
                          {entering === team.id ? t("Opening…") : t("Enter")}
                        </Button>
                      )}
                      {draft ? (
                        <>
                          <NudeButton
                            onClick={() => void handleSave(team.id)}
                            disabled={saving === team.id}
                            title={t("Save")}
                          >
                            <CheckmarkIcon size={18} color="currentColor" />
                          </NudeButton>
                          <NudeButton
                            onClick={() => cancelEdit(team.id)}
                            title={t("Cancel")}
                          >
                            <CloseIcon size={18} color="currentColor" />
                          </NudeButton>
                        </>
                      ) : (
                        <>
                          <NudeButton
                            onClick={() => startEdit(team)}
                            title={t("Edit")}
                          >
                            <EditIcon size={18} color="currentColor" />
                          </NudeButton>
                          <NudeButton
                            onClick={() => void handleDelete(team)}
                            disabled={deleting === team.id}
                            title={t("Delete")}
                          >
                            <TrashIcon size={18} color="currentColor" />
                          </NudeButton>
                        </>
                      )}
                    </Actions>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Scene>
  );
}

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
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
    border-bottom: 1px solid ${(p) => transparentize(0.3, p.theme.divider)};
    color: ${s("text")};
    vertical-align: middle;
  }

  tr:last-child td {
    border-bottom: 0;
  }
`;

const InlineInput = styled.input`
  background: ${s("inputBackground")};
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 14px;
  color: ${s("text")};
  width: 100%;
  outline: none;

  &:focus {
    border-color: ${s("accent")};
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 4px;
  justify-content: flex-end;
`;

export default observer(Ops);
