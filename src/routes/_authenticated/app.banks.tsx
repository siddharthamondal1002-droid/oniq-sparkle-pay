import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Landmark, Plus, Star, Trash2, X, ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/app/banks")({
  component: BanksScreen,
});

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCT_RE = /^[0-9]{9,18}$/;

type Bank = {
  id: string;
  holder_name: string;
  bank_name: string;
  ifsc: string;
  account_last4: string;
  nickname: string | null;
  is_primary: boolean;
};

function BanksScreen() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [withdrawFrom, setWithdrawFrom] = useState<Bank | null>(null);

  const { data: banks, isLoading } = useQuery({
    queryKey: ["banks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_accounts")
        .select("*")
        .order("is_primary", { ascending: false })
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Bank[];
    },
  });

  async function makePrimary(id: string) {
    const { error } = await supabase.rpc("set_primary_bank", { _bank_id: id });
    if (error) return toast.error(error.message);
    toast.success("Primary account updated ⭐");
    qc.invalidateQueries({ queryKey: ["banks"] });
  }

  async function remove(bank: Bank) {
    if (!window.confirm(`Remove ${bank.bank_name} ••${bank.account_last4}?`)) return;
    const { error } = await supabase.from("bank_accounts").delete().eq("id", bank.id);
    if (error) return toast.error(error.message);
    toast.success("Account removed");
    qc.invalidateQueries({ queryKey: ["banks"] });
  }

  return (
    <div className="px-5 pt-12 pb-6">
      <div className="flex items-center gap-3">
        <Link to="/app/wallet" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Linked banks</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        For your safety, ONIQ keeps only the last 4 digits of any account — never the full number.
      </p>

      <div className="mt-5 space-y-2">
        {isLoading && <div className="h-24 animate-pulse rounded-3xl bg-card" />}

        {banks?.map((b) => (
          <div key={b.id} data-testid="bank-card" className="rounded-3xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/15 text-primary">
                <Landmark className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {b.nickname || b.bank_name}
                  {b.is_primary && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Primary
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {b.bank_name} ••{b.account_last4} · {b.ifsc}
                </div>
                <div className="text-xs text-muted-foreground">{b.holder_name}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <button
                onClick={() => setWithdrawFrom(b)}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 py-2 font-medium text-primary"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" /> Withdraw
              </button>
              <button
                onClick={() => makePrimary(b.id)}
                disabled={b.is_primary}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-border py-2 font-medium disabled:opacity-40"
              >
                <Star className="h-3.5 w-3.5" /> Primary
              </button>
              <button
                onClick={() => remove(b)}
                aria-label={`Remove ${b.bank_name} account`}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-border py-2 font-medium text-muted-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            </div>
          </div>
        ))}

        {banks && banks.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No banks linked yet — add one and unlock withdrawals 🏦
          </div>
        )}
      </div>

      <button
        onClick={() => setShowAdd(true)}
        data-testid="add-bank"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground"
      >
        <Plus className="h-4 w-4" /> Add bank account
      </button>

      {showAdd && (
        <AddBankSheet
          onClose={() => setShowAdd(false)}
          onDone={() => {
            setShowAdd(false);
            qc.invalidateQueries({ queryKey: ["banks"] });
          }}
        />
      )}

      {withdrawFrom && (
        <WithdrawSheet
          bank={withdrawFrom}
          onClose={() => setWithdrawFrom(null)}
          onDone={() => {
            setWithdrawFrom(null);
            qc.invalidateQueries({ queryKey: ["wallet"] });
            qc.invalidateQueries({ queryKey: ["transactions"] });
          }}
        />
      )}
    </div>
  );
}

// ---------------- Add bank ----------------

function AddBankSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [holder, setHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [account, setAccount] = useState("");
  const [confirmAccount, setConfirmAccount] = useState("");
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const acct = account.replace(/\s/g, "");
    const code = ifsc.trim().toUpperCase();
    if (holder.trim().length < 3) return toast.error("Enter the account holder's name");
    if (bankName.trim().length < 2) return toast.error("Enter the bank name");
    if (!IFSC_RE.test(code)) return toast.error("IFSC looks off — format is like HDFC0001234");
    if (!ACCT_RE.test(acct)) return toast.error("Account number must be 9–18 digits");
    if (acct !== confirmAccount.replace(/\s/g, "")) return toast.error("Account numbers don't match — retype to confirm");

    setSaving(true);
    const { error } = await supabase.rpc("add_bank_account", {
      _holder_name: holder.trim(),
      _bank_name: bankName.trim(),
      _ifsc: code,
      _account_number: acct,
      _nickname: nickname.trim() || undefined,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`${bankName.trim()} linked ✅ we only kept the last 4 digits`);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Add bank account</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <FieldLabel>Account holder name</FieldLabel>
        <SheetInput value={holder} onChange={setHolder} placeholder="As printed on your passbook" />

        <FieldLabel>Bank name</FieldLabel>
        <SheetInput value={bankName} onChange={setBankName} placeholder="HDFC Bank" />

        <FieldLabel>IFSC code</FieldLabel>
        <SheetInput
          value={ifsc}
          onChange={(v) => setIfsc(v.toUpperCase())}
          placeholder="HDFC0001234"
          autoCapitalize="characters"
        />

        <FieldLabel>Account number</FieldLabel>
        <SheetInput value={account} onChange={setAccount} placeholder="9–18 digits" inputMode="numeric" type="password" />

        <FieldLabel>Re-enter account number</FieldLabel>
        <SheetInput value={confirmAccount} onChange={setConfirmAccount} placeholder="Type it again" inputMode="numeric" />

        <FieldLabel>Nickname (optional)</FieldLabel>
        <SheetInput value={nickname} onChange={setNickname} placeholder="Salary account" />

        <p className="mt-3 text-xs text-muted-foreground">
          🔒 Your full account number is validated and immediately discarded — only the last 4 digits are saved.
        </p>

        <button
          onClick={submit}
          disabled={saving}
          data-testid="save-bank"
          className="mt-4 w-full rounded-2xl bg-primary py-3 font-semibold text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Linking…" : "Link account 🏦"}
        </button>
      </div>
    </div>
  );
}

// ---------------- Withdraw ----------------

function WithdrawSheet({ bank, onClose, onDone }: { bank: Bank; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 10000) {
      return toast.error("Enter an amount up to $10k");
    }
    setBusy(true);
    const { error } = await supabase.rpc("withdraw_to_bank", {
      _bank_id: bank.id,
      _amount: Math.round(amt * 100) / 100,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`$${amt.toFixed(2)} sent to ${bank.bank_name} ••${bank.account_last4} 🏦 (demo)`);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Withdraw to bank</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="rounded-2xl border border-border bg-background p-3 text-sm">
          {bank.bank_name} ••{bank.account_last4}
          <span className="ml-2 text-xs text-muted-foreground">{bank.ifsc}</span>
        </div>
        <FieldLabel>Amount (USD)</FieldLabel>
        <SheetInput value={amount} onChange={setAmount} placeholder="0.00" type="number" inputMode="decimal" />
        <p className="mt-2 text-xs text-muted-foreground">
          Demo mode: deducts from your ONIQ balance and records a withdrawal — no real bank transfer happens yet.
        </p>
        <button
          onClick={submit}
          disabled={busy}
          data-testid="confirm-withdraw"
          className="mt-4 w-full rounded-2xl bg-primary py-3 font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Withdrawing…" : "Withdraw 🏦"}
        </button>
      </div>
    </div>
  );
}

// ---------------- tiny form primitives ----------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mt-4 block text-xs text-muted-foreground">{children}</label>;
}

function SheetInput({
  value,
  onChange,
  ...rest
}: { value: string; onChange: (v: string) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  return (
    <input
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
    />
  );
}
