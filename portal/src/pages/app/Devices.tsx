import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { MonitorSmartphone } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Device } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Table, Badge, statusTone, Empty } from "../../components/ui";

export default function DevicesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();

  const { data: devices } = useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const { data } = await supabase
        .from("devices")
        .select("*, profiles(full_name)")
        .order("created_at", { ascending: false });
      return (data ?? []) as (Device & { profiles: { full_name: string } | null })[];
    },
  });

  async function act(id: string, status: Device["status"]) {
    await supabase.from("devices").update({ status }).eq("id", id);
    if (status !== "active") {
      // pulls the rug on any activation bound to this device
      await supabase.from("license_activations").update({ revoked_at: new Date().toISOString() }).eq("device_id", id);
    }
    await supabase.rpc("audit", { p_action: `device.${status}`, p_target_type: "device", p_target_id: id });
    qc.invalidateQueries({ queryKey: ["devices"] });
  }

  async function rename(id: string, current: string) {
    const name = prompt("Device name", current);
    if (!name) return;
    await supabase.from("devices").update({ name }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["devices"] });
  }

  return (
    <>
      <PageHeader
        title="Desktop Activations"
        subtitle="Windows machines bound to licenses via encrypted hardware fingerprints."
      />
      {!devices?.length ? (
        <Empty text="No devices activated yet. Install the desktop app and enter a license key." />
      ) : (
        <Table headers={["Device", "Owner", "OS", "Last Seen", "Status", can("devices.manage") ? "Actions" : ""]}>
          {devices.map((d) => (
            <tr key={d.id} className="hover:bg-surface-2/50">
              <td className="td">
                <div className="flex items-center gap-2 text-zinc-100">
                  <MonitorSmartphone size={14} className="text-zinc-500" /> {d.name}
                </div>
              </td>
              <td className="td text-zinc-400">{d.profiles?.full_name ?? "—"}</td>
              <td className="td text-zinc-400">{(d.os_info as any)?.release ?? "Windows"}</td>
              <td className="td text-zinc-400">
                {d.last_seen_at ? formatDistanceToNow(new Date(d.last_seen_at), { addSuffix: true }) : "never"}
              </td>
              <td className="td"><Badge tone={statusTone[d.status]}>{d.status}</Badge></td>
              {can("devices.manage") && (
                <td className="td space-x-2 whitespace-nowrap">
                  <button className="text-xs text-zinc-400 hover:underline" onClick={() => rename(d.id, d.name)}>Rename</button>
                  {d.status === "active" ? (
                    <button className="text-xs text-warn hover:underline" onClick={() => act(d.id, "deactivated")}>Deactivate</button>
                  ) : (
                    <button className="text-xs text-ok hover:underline" onClick={() => act(d.id, "active")}>Reactivate</button>
                  )}
                  <button className="text-xs text-danger hover:underline" onClick={() => act(d.id, "removed")}>Remove</button>
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
