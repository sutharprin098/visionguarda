import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "../../lib/supabase";
import { License } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Table, Badge, statusTone, Empty } from "../../components/ui";

export default function LicensesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();

  const { data: licenses } = useQuery({
    queryKey: ["licenses"],
    queryFn: async () => {
      const { data } = await supabase
        .from("licenses")
        .select("*, profiles(full_name, email), license_activations(device_id, revoked_at)")
        .order("created_at");
      return (data ?? []) as (License & {
        profiles: { full_name: string; email: string } | null;
        license_activations: { device_id: string; revoked_at: string | null }[];
      })[];
    },
  });

  async function setStatus(id: string, status: License["status"]) {
    await supabase.from("licenses").update({ status }).eq("id", id);
    await supabase.rpc("audit", { p_action: `license.${status}`, p_target_type: "license", p_target_id: id });
    qc.invalidateQueries({ queryKey: ["licenses"] });
  }

  return (
    <>
      <PageHeader
        title="Licenses"
        subtitle="Encrypted license keys bound to users and devices. Full keys are shown only once at creation."
      />
      {!licenses?.length ? (
        <Empty text="No licenses." />
      ) : (
        <Table headers={["Key", "Assigned To", "Type", "Devices", "Status", "Expires", can("licenses.manage") ? "Actions" : ""]}>
          {licenses.map((l) => {
            const activeDevices = l.license_activations?.filter((a) => !a.revoked_at).length ?? 0;
            return (
              <tr key={l.id} className="hover:bg-surface-2/50">
                <td className="td"><span className="keychip">{l.key_hint}</span></td>
                <td className="td">
                  <div className="text-zinc-100">{l.profiles?.full_name ?? "Unassigned"}</div>
                  <div className="text-xs text-zinc-500">{l.profiles?.email}</div>
                </td>
                <td className="td">
                  <Badge tone={l.kind === "admin" ? "accent" : "default"}>{l.kind}</Badge>
                </td>
                <td className="td text-zinc-400">{activeDevices} / {l.max_devices}</td>
                <td className="td"><Badge tone={statusTone[l.status]}>{l.status}</Badge></td>
                <td className="td text-zinc-400">
                  {l.expires_at ? format(new Date(l.expires_at), "dd MMM yyyy") : "Never"}
                </td>
                {can("licenses.manage") && (
                  <td className="td space-x-2 whitespace-nowrap">
                    {l.status === "active" ? (
                      <>
                        <button className="text-xs text-warn hover:underline" onClick={() => setStatus(l.id, "suspended")}>Suspend</button>
                        <button className="text-xs text-danger hover:underline" onClick={() => setStatus(l.id, "revoked")}>Revoke</button>
                      </>
                    ) : l.status !== "revoked" ? (
                      <button className="text-xs text-ok hover:underline" onClick={() => setStatus(l.id, "active")}>Activate</button>
                    ) : null}
                  </td>
                )}
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
