// src/pages/Transactions.tsx
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/tauri";
import { Button, Badge, PageHeader, EmptyState, Loading, formatCurrency } from "../components/ui";
import { useAuthStore } from "../store/authStore";

type TxRow = { id: string; invoice_no: string; cashier_name: string; customer_name?: string; total: number; status: string; created_at: string };

export default function TransactionsPage() {
  const [txs, setTxs]       = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { can }               = useAuthStore();

  const load = async () => {
    setLoading(true);
    const data = await api.transactions.list(100).catch(() => []);
    setTxs(data as TxRow[]); setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleVoid = async (id: string) => {
    const reason = prompt("Alasan void:");
    if (!reason) return;
    try {
      await api.transactions.void(id, reason);
      toast.success("Transaksi di-void");
      load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Gagal"); }
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Riwayat Transaksi" />
      <div className="flex-1 overflow-y-auto">
        {loading ? <Loading /> : txs.length === 0 ? <EmptyState message="Belum ada transaksi" icon="📋" /> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>{["Nota","Kasir","Pelanggan","Total","Status","Waktu",""].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {txs.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{t.invoice_no}</td>
                  <td className="px-4 py-3">{t.cashier_name}</td>
                  <td className="px-4 py-3 text-gray-500">{t.customer_name ?? "—"}</td>
                  <td className="px-4 py-3 font-medium">{formatCurrency(t.total)}</td>
                  <td className="px-4 py-3">
                    <Badge label={t.status} color={t.status === "completed" ? "green" : t.status === "void" ? "red" : "yellow"} />
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(t.created_at).toLocaleString("id-ID")}</td>
                  <td className="px-4 py-3">
                    {can("void_transaction") && t.status === "completed" && (
                      <Button size="sm" variant="danger" onClick={() => handleVoid(t.id)}>Void</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}