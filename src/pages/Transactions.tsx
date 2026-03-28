// src/pages/Transactions.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { api, TransactionPage, TransactionQuery } from "../lib/tauri";
import { Button, Badge, PageHeader, EmptyState, Loading, formatCurrency, formatDate, Modal } from "../components/ui";
import { useAuthStore } from "../store/authStore";
import clsx from "clsx";


// ─────────────────────────────────────────────
// Column definitions
// ─────────────────────────────────────────────
type ColKey = "invoice_no" | "cashier_name" | "customer_name" | "total" | "status" | "sync" | "created_at";
type SortableKey = Extract<TransactionQuery["sort_by"], string>;

interface ColDef {
  key: ColKey;
  label: string;
  visible: boolean;
  sortBy?: SortableKey;   // undefined = not sortable
  align?: "right";
  width?: string;
}

const DEFAULT_COLS: ColDef[] = [
  { key: "invoice_no", label: "NOTA", visible: true, sortBy: "invoice_no", width: "w-24" },
  { key: "cashier_name", label: "Nama Kasir", visible: true, sortBy: "cashier_name", width: "w-28" },
  { key: "customer_name", label: "Nama Pembeli", visible: true, sortBy: "customer_name", width: "w-28" },
  { key: "total", label: "Total", visible: true, sortBy: "total", align: "right", width: "w-24" },
  { key: "status", label: "Status", visible: true, width: "w-20" },
  { key: "sync", label: "Sync", visible: true, width: "w-20" },
  { key: "created_at", label: "Tgl Transaksi", visible: true, width: "w-20" },
];

const PAGE_SIZES = [10, 25, 50, 100];

// ─────────────────────────────────────────────
// Badges
// ─────────────────────────────────────────────
function StatusBadge({ status }: { status: String }) {
  return (
    <span className={clsx(
      "inline-block text-xs px-2 py-0.5 rounded-full font-medium uppercase",
      status == 'completed' ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
    )}>
      {status}
    </span>
  );
}

function SyncBadge({ synced }: { synced: boolean }) {
  return (
    <span className={clsx(
      "inline-block text-xs px-2 py-0.5 rounded-full font-medium",
      synced ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"
    )}>
      {synced ? "Synced" : "Lokal"}
    </span>
  );
}

type TxRow = { id: string; invoice_no: string; cashier_name: string; customer_name?: string; total: number; status: string; created_at: string };

export default function TransactionsPages() {

  const [result, setResult] = useState<TransactionPage | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { can } = useAuthStore();

  // Query state (maps 1-to-1 to TransactionQuery)
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("");
  const [filterSt, setFilterSt] = useState<string>("");
  const [filterCust, setFilterCust] = useState<string>("");
  const [filterCashier, setFilterCashier] = useState<string>("");
  const [filterSync, setFilterSync] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortableKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  // UI state
  const [cols, setCols] = useState<ColDef[]>(DEFAULT_COLS);
  const [colsOpen, setColsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const colsRef = useRef<HTMLDivElement>(null);

  const [modalDetail, setModalDetail] = useState<string>("");

  // Debounce search to avoid firing on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ── Reset to page 1 when filters/sort change ──────────────
  useEffect(() => { setPage(1); }, [debouncedSearch, filterSt, filterCust, filterCashier, filterSync, sortBy, sortDir, perPage]);

  // ── Fetch ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query: TransactionQuery = {
        page,
        per_page: perPage,
        sort_by: sortBy,
        sort_dir: sortDir,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(filterSt as TransactionQuery["status"] && { status: filterSt as TransactionQuery["status"] }),
        ...(filterCust as TransactionQuery["customer_id"] && { customer_id: filterCust as TransactionQuery["customer_id"] }),
        ...(filterSync as TransactionQuery["sync_status"] && { sync_status: filterSync as TransactionQuery["sync_status"] }),
      };
      const res = await api.transactions.list(query);
      // @ts-ignore
      setResult(res);
    } catch (e: unknown) {
      toast.error("Gagal memuat Transaksi");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filterSt, filterCust, filterCashier, filterSync, sortBy, sortDir, perPage]);


  // const load = async () => {
  //   setLoading(true);
  //   const data = await api.transactions.list(100).catch(() => []);
  //   setTxs(data as TxRow[]); setLoading(false);
  // };

  useEffect(() => { load(); }, [load]);

  // Close column picker on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── Sort toggle ───────────────────────────────────────────
  const handleSort = (key: SortableKey) => {
    if (sortBy === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("asc"); }
  };

  // ── Selection ─────────────────────────────────────────────
  const pageData = result?.data ?? [];

  const toggleRow = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = (checked: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      pageData.forEach((p) => checked ? n.add(p.id) : n.delete(p.id));
      return n;
    });

  const allOnPageSelected = pageData.length > 0 && pageData.every((p) => selected.has(p.id));
  const clearSelection = () => setSelected(new Set());

  // ── Pagination range ──────────────────────────────────────
  const totalPages = result?.total_pages ?? 1;
  const buildRange = (): (number | "…")[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const r: (number | "…")[] = [1];
    if (page > 3) r.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) r.push(i);
    if (page < totalPages - 2) r.push("…");
    r.push(totalPages);
    return r;
  };

  const visibleCols = cols.filter((c) => c.visible);

  // ── Sort indicator ────────────────────────────────────────
  const SortIcon = ({ colSortBy }: { colSortBy?: SortableKey }) => {
    if (!colSortBy) return null;
    const active = sortBy === colSortBy;
    return (
      <span className={clsx("ml-1 text-[10px]", active ? "text-gray-700" : "text-gray-300")}>
        {active ? (sortDir === "asc" ? "▲" : "▼") : "▲"}
      </span>
    );
  };

  const handleVoid = async (id: string) => {
    const reason = prompt("Alasan void:");
    if (!reason) return;
    try {
      await api.transactions.void(id, reason);
      toast.success("Transaksi di-void");
      load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Gagal"); }
  };

  const handleBulkVoid = async () => {
    const reason = prompt("Alasan void:");
    if (!reason) return;
    try {
      const listIds = Array.from(selected).join(",");
      await api.transactions.voids(listIds, reason);
      toast.success("Transaksi di-void");
      load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Gagal"); }
  };

  const openDetail = async (id) => {
    setModalDetail(id)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Riwayat Transaksi" />
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-gray-100 bg-white">
        {/* Search */}
        <div className="relative flex-1 min-w-44">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6.5" cy="6.5" r="4" /><path d="M10 10l3 3" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama, SKU, barcode…"
            className="w-full pl-7 pr-3 py-1.5 text-sm border border-gray-300 rounded-md outline-none
                             focus:border-gray-500 focus:ring-1 focus:ring-gray-300"
          />
        </div>

        {/* Filters */}

        <Chip value={filterSt} onChange={(v) => setFilterSt(v)}>
          <option value="">Semua Status</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
        </Chip>

        <Chip value={filterSync} onChange={(v) => setFilterSync(v)}>
          <option value="">Semua Sync</option>
          <option value="synced">Synced</option>
          <option value="local">Lokal</option>
        </Chip>

        {/* Column picker */}
        <div className="relative" ref={colsRef}>
          <button
            onClick={() => setColsOpen((v) => !v)}
            className="h-8 px-3 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
          >
            Kolom ▾
          </button>
          {colsOpen && (
            <div className="absolute right-0 top-9 z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-1.5 w-40">
              {cols.map((col) => (
                <label key={col.key}
                  className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 rounded hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={col.visible}
                    onChange={() => setCols((prev) =>
                      prev.map((c) => c.key === col.key ? { ...c, visible: !c.visible } : c)
                    )}
                    className="w-3.5 h-3.5"
                  />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100 text-sm">
          <span className="font-medium text-blue-900">{selected.size} dipilih</span>
          <button onClick={handleBulkVoid}
            className="text-xs px-2.5 py-1 border border-blue-200 rounded bg-white text-blue-700 hover:bg-blue-50">
            Void-kan Transaksi
          </button>
          <button onClick={clearSelection}
            className="text-xs px-2.5 py-1 border border-blue-200 rounded bg-white text-blue-700 hover:bg-blue-50 ml-auto">
            Batal pilih
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <Loading />
        ) : !result || result.data.length === 0 ? (
          <EmptyState message="Tidak ada produk yang cocok." />
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr>
                <th className="w-9 px-3 py-2.5 border-b border-gray-200">
                  <input type="checkbox" checked={allOnPageSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="w-3.5 h-3.5 cursor-pointer" />
                </th>

                {visibleCols.map((col) => (
                  <th
                    key={col.key}
                    onClick={col.sortBy ? () => handleSort(col.sortBy!) : undefined}
                    className={clsx(
                      "px-3 py-2.5 border-b border-gray-200 text-left text-xs font-medium",
                      "text-gray-500 uppercase tracking-wide select-none whitespace-nowrap",
                      col.width,
                      col.align === "right" && "text-right",
                      col.sortBy && "cursor-pointer hover:text-gray-800",
                      sortBy === col.sortBy && "text-gray-800"
                    )}
                  >
                    {col.label}
                    <SortIcon colSortBy={col.sortBy} />
                  </th>
                ))}

                <th className="w-24 px-3 py-2.5 border-b border-gray-200" />
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {pageData.map((p) => {
                const isSel = selected.has(p.id);

                return (
                  <tr key={p.id} className={clsx(
                    "group transition-colors",
                    isSel ? "bg-blue-50" : "hover:bg-gray-50"
                  )}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={isSel} onChange={() => toggleRow(p.id)}
                        className="w-3.5 h-3.5 cursor-pointer" />
                    </td>

                    {visibleCols.map((col) => (
                      <td key={col.key}
                        className={clsx("px-3 py-2.5 max-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
                          col.align === "right" && "text-right")}>

                        {col.key === "invoice_no" && (
                          <span className="font-mono text-xs text-gray-500">{p.invoice_no}</span>
                        )}
                        {col.key === "cashier_name" && (
                          <span className="font-medium" title={p.cashier_name}>{p.cashier_name}</span>
                        )}
                        {col.key === "customer_name" && (
                          <span className="font-medium" title={p.customer_name}>{p.customer_name}</span>
                        )}
                        {col.key === "total" && formatCurrency(p.total)}

                        {col.key === "status" && <StatusBadge status={p.status} />}
                        {col.key === "sync" && <SyncBadge synced={!!p.synced_at} />}
                        {col.key == "created_at" && (
                          <span className="font-medium">{formatDate(p.created_at)}</span>
                        )}
                      </td>
                    ))}

                    {/* Actions — visible on row hover */}
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5 invisible group-hover:visible">
                        <button onClick={() => handleVoid(p)}
                          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 text-gray-600">
                          Void
                        </button>
                        <button onClick={() => openDetail(p.id)}
                          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 text-gray-600">
                          Detail
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      {result && result.total > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-white gap-4 flex-wrap text-xs text-gray-500">
          {/* Rows per page */}
          <div className="flex items-center gap-1.5">
            Tampilkan
            <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}
              className="h-7 border border-gray-300 rounded px-1.5 outline-none text-xs">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            baris
          </div>

          {/* Info */}
          <span>
            {((result.page - 1) * result.per_page + 1).toLocaleString("id-ID")}–
            {Math.min(result.page * result.per_page, result.total).toLocaleString("id-ID")} dari{" "}
            {result.total.toLocaleString("id-ID")} produk
          </span>

          {/* Page buttons */}
          <div className="flex items-center gap-1">
            <PageBtn onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>‹</PageBtn>
            {buildRange().map((pg, i) =>
              pg === "…" ? (
                <span key={`e${i}`} className="px-1 text-gray-400">…</span>
              ) : (
                <PageBtn key={pg} onClick={() => setPage(pg as number)} current={pg === page}>
                  {pg}
                </PageBtn>
              )
            )}
            <PageBtn onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>›</PageBtn>
          </div>
        </div>
      )}


      {modalDetail != "" && (
        <DetailModal transactionId={modalDetail} onClose={() => setModalDetail("")}></DetailModal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function Chip({ value, onChange, children }: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-8 text-sm border border-gray-300 rounded-md px-2 outline-none text-gray-600 bg-white cursor-pointer hover:border-gray-400">
      {children}
    </select>
  );
}

function PageBtn({ children, onClick, disabled, current }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  current?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={clsx(
        "w-7 h-7 text-xs rounded flex items-center justify-center border transition-colors",
        current
          ? "bg-gray-900 text-white border-gray-900"
          : "border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default"
      )}>
      {children}
    </button>
  );
}

function DetailModal({ transactionId, onClose }: {
  transactionId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let ignore = false;

    setLoading(true);

    api.transactions.get(transactionId).then((result) => {
      if (!ignore) {
        setDetail(result);
        setLoading(false);
      }
    });

    return () => {
      ignore = true;
    };
  }, [transactionId]);


  return <Modal open title="Detail Transaksi" onClose={onClose} width="max-w-lg">
  {loading && (<Loading />)}

  {!loading && (
    <div className="w-full space-y-4 text-sm">

      {/* Header Info */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="flex justify-between">
          <span className="text-gray-500">No. Invoice</span>
          <span className="font-medium">{detail?.invoice_no}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-gray-500">Kasir</span>
          <span>{detail?.cashier_name}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-gray-500">Tanggal</span>
          <span>{formatDate(detail?.created_at)}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-gray-500">Customer</span>
          <span>{detail?.customer_name || "-"}</span>
        </div>
      </div>

      {/* Items */}
      <div className="border rounded-lg p-4">
        <h2 className="font-semibold mb-3">Item</h2>

        <div className="space-y-2">
          {detail?.items && detail?.items.length > 0 ? detail?.items?.map((item, i) => (
            <div key={i} className="flex justify-between border-b pb-2 last:border-0">
              <div>
                <p className="font-medium">{item.product_name}</p>
                <p className="text-gray-500 text-xs">
                  {item.qty} x {formatCurrency(item.unit_price)}
                </p>
              </div>
              <div className="font-medium">
                {formatCurrency(item.total)}
              </div>
            </div>
          )) : ""}
        </div>
      </div>

      {/* Total */}
      <div className="border rounded-lg p-4">
        <div className="flex justify-between font-semibold text-base">
          <span>Total</span>
          <span>{formatCurrency(detail?.total)}</span>
        </div>
        <br />
        <div className="flex justify-between text-base">
          <span>Paid Amount</span>
          <span>{formatCurrency(detail?.paid_amount)}</span>
        </div>
        <div className="flex justify-between text-base">
          <span>Payment Method</span>
          <span className="uppercase">{(detail?.payments?.[0]?.method)}</span>
        </div>
        <div className="flex justify-between text-base">
          <span>Change Amount</span>
          <span>{formatCurrency(detail?.change_amount)}</span>
        </div>
      </div>

    </div>
  )}
</Modal>
}