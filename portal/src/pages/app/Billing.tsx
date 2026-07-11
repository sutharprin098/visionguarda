import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Kpi, Badge, statusTone, Empty } from "../../components/ui";
import { fmtDate, fmtDateTime, fmtMoney } from "../../lib/format";

interface Subscription {
  id: string;
  plan: string;
  seats: number;
  camera_limit: number;
  status: "active" | "past_due" | "canceled" | "trialing";
  period_start: string;
  period_end: string | null;
}

interface Invoice {
  id: string;
  amount_cents: number;
  currency: string;
  status: "paid" | "open" | "void" | "failed";
  invoice_url: string | null;
  created_at: string;
}

export default function BillingPage() {
  const { org } = useAuth();

  const { data } = useQuery({
    queryKey: ["billing"],
    queryFn: async () => {
      const [subs, invoices, usage, counts] = await Promise.all([
        supabase.from("subscriptions").select("*").order("period_start", { ascending: false }).limit(1),
        supabase.from("billing").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("usage_logs").select("metric, quantity")
          .in("metric", ["storage_mb", "stream_minutes"]),
        Promise.all([
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("cameras").select("id", { count: "exact", head: true }),
        ]),
      ]);
      const totals: Record<string, number> = {};
      for (const u of usage.data ?? []) totals[u.metric] = (totals[u.metric] ?? 0) + Number(u.quantity);
      return {
        sub: (subs.data?.[0] ?? null) as Subscription | null,
        invoices: (invoices.data ?? []) as Invoice[],
        totals,
        seatsUsed: counts[0].count ?? 0,
        camerasUsed: counts[1].count ?? 0,
      };
    },
  });

  const sub = data?.sub;
  const paidTotal = data?.invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount_cents, 0) ?? 0;

  return (
    <>
      <PageHeader title="Billing" subtitle="Subscription, seat usage and invoice history for your organization." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Plan" value={sub?.plan ?? org?.plan ?? "trial"}
             hint={sub ? <Badge tone={statusTone[sub.status]}>{sub.status}</Badge> : "no subscription record"} />
        <Kpi label="Seats" value={sub ? `${data?.seatsUsed ?? 0} / ${sub.seats}` : data?.seatsUsed ?? "—"}
             hint={sub && (data?.seatsUsed ?? 0) > sub.seats ? <span className="text-warn">over seat limit</span> : undefined} />
        <Kpi label="Cameras" value={sub ? `${data?.camerasUsed ?? 0} / ${sub.camera_limit}` : data?.camerasUsed ?? "—"} />
        <Kpi label="Paid to Date" value={fmtMoney(paidTotal)} />
      </div>

      {sub && (
        <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <div className="text-sm font-semibold text-ink-1">Current period</div>
            <p className="mt-0.5 text-sm text-ink-3">
              {fmtDate(sub.period_start)} — {sub.period_end ? fmtDate(sub.period_end) : "ongoing"}
            </p>
          </div>
          <Badge tone={statusTone[sub.status]}>{sub.status}</Badge>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-1">Invoices</h2>
      {!data?.invoices.length ? (
        <Empty text="No invoices yet. Invoices appear here once billing is active for your organization." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr>
                <th className="th">Date</th><th className="th">Amount</th>
                <th className="th">Status</th><th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((i) => (
                <tr key={i.id} className="hover:bg-surface-2">
                  <td className="td text-ink-2">{fmtDateTime(i.created_at)}</td>
                  <td className="td font-medium text-ink-1">{fmtMoney(i.amount_cents, i.currency)}</td>
                  <td className="td"><Badge tone={statusTone[i.status]}>{i.status}</Badge></td>
                  <td className="td text-right">
                    {i.invoice_url && (
                      <a className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                         href={i.invoice_url} target="_blank" rel="noreferrer">
                        Invoice <ExternalLink size={11} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-1">Metered usage (all time)</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Kpi label="Storage" value={`${Math.round(data?.totals["storage_mb"] ?? 0)} MB`} />
        <Kpi label="Stream Minutes" value={Math.round(data?.totals["stream_minutes"] ?? 0)} />
      </div>
    </>
  );
}
