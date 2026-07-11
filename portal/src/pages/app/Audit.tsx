import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "../../lib/supabase";
import { AuditLog } from "../../lib/types";
import { PageHeader, Table, Badge, Empty } from "../../components/ui";

export default function AuditPage() {
  const [filter, setFilter] = useState("");

  const { data: logs } = useQuery({
    queryKey: ["audit", filter],
    queryFn: async () => {
      let q = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
      if (filter) q = q.ilike("action", `%${filter}%`);
      return (await q).data as AuditLog[];
    },
  });

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="Append-only record of every action: who, what, when, from where."
        actions={
          <input className="input w-56" placeholder="Filter by action…" value={filter}
                 onChange={(e) => setFilter(e.target.value)} />
        }
      />
      {!logs?.length ? (
        <Empty text="No audit entries match." />
      ) : (
        <Table headers={["Time", "Actor", "Action", "Target", "IP"]}>
          {logs.map((l) => (
            <tr key={l.id} className="hover:bg-surface-2/50">
              <td className="td whitespace-nowrap text-zinc-400">
                {format(new Date(l.created_at), "dd MMM HH:mm:ss")}
              </td>
              <td className="td text-zinc-300">{l.actor_email || "system"}</td>
              <td className="td"><Badge tone={l.action.includes("revoke") || l.action.includes("delete") ? "danger" : "default"}>{l.action}</Badge></td>
              <td className="td text-zinc-400">
                {l.target_type && <span>{l.target_type} <span className="font-mono text-xs">{l.target_id.slice(0, 8)}</span></span>}
              </td>
              <td className="td font-mono text-xs text-zinc-500">{l.ip ?? "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
