// src/pages/Dashboard.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/tauri";
import { useAuthStore } from "../store/authStore";
import { Card, PageHeader, Button, formatCurrency } from "../components/ui";

export default function DashboardPage() {
  const { session, can } = useAuthStore();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ txCount: 0, revenue: 0, pending: 0 });

  useEffect(() => {
    if (!can("view_reports")) return;
    api.transactions.list(100, 0).then((txs) => {
      const completed = (txs as Record<string, unknown>[]).filter((t) => t["status"] === "completed");
      const revenue   = completed.reduce((s: number, t) => s + ((t["total"] as number) ?? 0), 0);
      setStats({ txCount: completed.length, revenue, pending: 0 });
    }).catch(() => {});
    api.sync.queueStats().then((q) => setStats((s) => ({ ...s, pending: q["pending"] ?? 0 }))).catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader
        title={`Halo, ${session?.full_name} 👋`}
        subtitle={new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        actions={
          <Button onClick={() => navigate("/pos")} size="lg">
            Buka Kasir
          </Button>
        }
      />
      <div className="p-6 space-y-6">
        {can("view_reports") && (
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-5">
              <p className="text-xs text-gray-400">Transaksi Bulan Ini</p>
              <p className="text-3xl font-bold mt-2">{stats.txCount}</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-gray-400">Pendapatan Bulan Ini</p>
              <p className="text-2xl font-bold mt-2">{formatCurrency(stats.revenue)}</p>
            </Card>
            <Card className="p-5">
              <p className="text-xs text-gray-400">Antrian Sync</p>
              <p className="text-3xl font-bold mt-2">{stats.pending}</p>
            </Card>
          </div>
        )}
        {/* Quick actions */}
        <div>
          <h2 className="text-sm font-medium text-gray-500 mb-3">Akses Cepat</h2>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Kasir", to: "/pos", perm: "pos" },
              { label: "Transaksi", to: "/transactions" },
              { label: "Produk", to: "/products", perm: "manage_products" },
              { label: "Sinkronisasi", to: "/sync", perm: "configure_sync" },
            ].filter((a) => !a.perm || can(a.perm)).map((a) => (
              <Button key={a.to} variant="secondary" onClick={() => navigate(a.to)}>{a.label}</Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}