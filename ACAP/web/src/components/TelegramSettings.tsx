import { useEffect, useState } from "react";
import { X, Send, Check, Loader2 } from "lucide-react";
import { getSupabase } from "../lib/session";

/**
 * Telegram notification settings, in the desktop Admin Studio. This is the same
 * configuration surface as the web portal's Settings → Telegram tab and writes
 * the SAME row (public.telegram_settings, one per org), so a value set here or
 * there is the one the alert-insert trigger delivers with. Enable + bot token +
 * chat id + a test send — deliberately no per-detection toggles, matching the
 * "send whatever the active model produces" contract of migration 0037.
 *
 * Writes go through RLS (org.manage). A user who can open Admin Studio but lacks
 * org.manage will get a clear permission error rather than a silent no-op.
 */
export default function TelegramSettings({ orgId, onClose }: { orgId: string | null; onClose: () => void }) {
  const [form, setForm] = useState({ enabled: false, bot_token: "", chat_id: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ tone: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const sb = await getSupabase();
      const { data, error } = await sb.from("telegram_settings").select("*").maybeSingle();
      if (!active) return;
      if (error) setError(error.message);
      if (data) setForm({ enabled: !!data.enabled, bot_token: data.bot_token ?? "", chat_id: data.chat_id ?? "" });
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  async function save() {
    if (!orgId) { setError("No organization context — cannot save."); return; }
    setBusy(true);
    setError(null);
    const sb = await getSupabase();
    const { error } = await sb.from("telegram_settings").upsert({
      org_id: orgId,
      enabled: form.enabled,
      bot_token: form.bot_token.trim(),
      chat_id: form.chat_id.trim(),
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) {
      setError(
        /permission|rls|denied|policy/i.test(error.message)
          ? "You don't have permission to change notification settings (needs org.manage). Ask an org admin."
          : error.message,
      );
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function test() {
    setTesting(true);
    setTestMsg(null);
    const sb = await getSupabase();
    const { error } = await sb.functions.invoke("telegram-test", {
      body: { bot_token: form.bot_token.trim(), chat_id: form.chat_id.trim() },
    });
    setTesting(false);
    setTestMsg(error
      ? { tone: "err", msg: "Test failed — check the bot token and chat ID." }
      : { tone: "ok", msg: "Test message sent — check your Telegram chat." });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-line bg-surface-1 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Telegram Notifications</div>
            <div className="text-[10px] text-zinc-500">Every alert your cameras raise is delivered automatically.</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-surface-2 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-zinc-500">
            <Loader2 size={15} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <label className="flex cursor-pointer items-center justify-between rounded-md border border-line bg-surface-0 px-3 py-2.5">
              <span className="text-xs font-medium text-zinc-200">Enable Telegram notifications</span>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="h-4 w-4 accent-[#5b8cff]"
              />
            </label>

            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Bot Token</label>
              <input
                type="password" autoComplete="off" placeholder="123456789:AA…"
                value={form.bot_token}
                onChange={(e) => setForm({ ...form, bot_token: e.target.value })}
                className="w-full rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-accent"
              />
              <p className="mt-1 text-[10px] text-zinc-500">Create a bot with @BotFather in Telegram and paste its token.</p>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Chat ID</label>
              <input
                placeholder="-1001234567890"
                value={form.chat_id}
                onChange={(e) => setForm({ ...form, chat_id: e.target.value })}
                className="w-full rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-accent"
              />
              <p className="mt-1 text-[10px] text-zinc-500">Add the bot to the chat/group, then use @userinfobot to find the numeric ID.</p>
            </div>

            {error && <p className="text-[11px] text-danger">{error}</p>}
            {testMsg && <p className={`text-[11px] ${testMsg.tone === "ok" ? "text-ok" : "text-danger"}`}>{testMsg.msg}</p>}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={save} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Save
              </button>
              <button
                onClick={test} disabled={testing || !form.bot_token.trim() || !form.chat_id.trim()}
                className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-zinc-300 hover:bg-surface-2 disabled:opacity-50"
              >
                {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Test
              </button>
              {saved && <span className="text-xs text-ok">Saved ✓</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
