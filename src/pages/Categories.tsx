// src/pages/Categories.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { api, Category, CategoryQuery, DataPaging } from "../lib/tauri";
import { Button, Input, Modal, PageHeader, EmptyState, Loading, formatDate } from "../components/ui";
import clsx from "clsx";


// ─────────────────────────────────────────────
// Column definitions
// ─────────────────────────────────────────────
type ColKey = "sort_order" | "name" | "description" | "sync" | "created_at";
type SortableKey = Extract<CategoryQuery["sort_by"], string>;

interface ColDef {
  key: ColKey;
  label: string;
  visible: boolean;
  sortBy?: SortableKey;   // undefined = not sortable
  align?: "right";
  width?: string;
}

const DEFAULT_COLS: ColDef[] = [
  { key: "name", label: "Nama", visible: true, sortBy: "name", width: "w-24" },
  { key: "sort_order", label: "Urutan", visible: true, width: "w-20" },
  { key: "sync", label: "Sync", visible: true, width: "w-20" },
  { key: "created_at", label: "Tgl Dibuat", visible: true, width: "w-20" },
];

const PAGE_SIZES = [10, 25, 50, 100];

export default function CategoriesPage() {
  const [result, setResult] = useState<DataPaging | null>(null);

  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Category | null | "new">(null);

  // Query state (maps 1-to-1 to TransactionQuery)
  const [search, setSearch] = useState("");
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



  // Debounce search to avoid firing on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ── Reset to page 1 when filters/sort change ──────────────
  useEffect(() => { setPage(1); }, [debouncedSearch, filterSync, sortBy, sortDir, perPage]);

  // ── Fetch ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query: CategoryQuery = {
        page,
        per_page: perPage,
        sort_by: sortBy,
        sort_dir: sortDir,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(filterSync as CategoryQuery["sync_status"] && { sync_status: filterSync as CategoryQuery["sync_status"] }),
      };
      const res = await api.categories.list(query);
      // @ts-ignore
      setResult(res);
    } catch (e: unknown) {
      toast.error("Gagal memuat list Kategori");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filterSync, sortBy, sortDir, perPage]);


  // const load = async () => {
  //   setLoading(true);
  //   const data = await api.categories.list().catch(() => []);
  //   setCats(data); setLoading(false);
  // };

  // useEffect(() => { load(); }, []);

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

  // ─────────────────────────────────────────────
  // Badges
  // ─────────────────────────────────────────────
  function StatusBadge({ active }: { active: boolean }) {
    return (
      <span className={clsx(
        "inline-block text-xs px-2 py-0.5 rounded-full font-medium",
        active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
      )}>
        {active ? "Aktif" : "Nonaktif"}
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

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Kategori" actions={<Button onClick={() => setEditing("new")}>+ Tambah</Button>} />
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
          <button 
            className="text-xs px-2.5 py-1 border border-red-200 rounded bg-white text-red-700 hover:bg-red-50">
            Hapus Kategori
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
                              {col.key === "sort_order" && (
                                <span className="font-mono text-xs text-gray-500">{p.sort_order}</span>
                              )}
                              {col.key === "name" && (
                                <span className="font-mono text-xs text-gray-500">{p.name}</span>
                              )}
                              {col.key === "description" && (
                                <span className="font-mono text-xs text-gray-500">{p.description}</span>
                              )}
                              {col.key === "sync" && <SyncBadge synced={!!p.synced_at} />}
                              {col.key == "created_at" && (
                                <span className="font-medium">{formatDate(p.created_at)}</span>
                              )}
                            </td>
                          ))}
      
                          {/* Actions — visible on row hover */}
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5 invisible group-hover:visible">
                             <button onClick={() => setEditing(p)}
                                className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 text-gray-600">
                                Edit
                              </button>
                              <button 
                                className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 text-gray-600">
                                Delete
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

    
      {editing !== null && (
        <CatModal
          cat={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
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


function CatModal({ cat, onClose, onSaved }: { cat: Category | null; onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit } = useForm({
    defaultValues: cat ?? { name: "", description: "", sort_order: 0 }
  });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: { name: string; description?: string; sort_order?: number }) => {
    setLoading(true);
    try {
      if (data?.sort_order) {
        data.sort_order = Number(data.sort_order)
      }
      if (cat) { await api.categories.update(cat.id, data); }
      else { await api.categories.create(data); }
      toast.success("Disimpan"); onSaved();
    } catch (e: unknown) { toast.error("Gagal"); }
    finally { setLoading(false); }
  };

  return (
    <Modal open title={cat ? "Edit Kategori" : "Tambah Kategori"} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <Input label="Nama *" {...register("name", { required: true })} />
        <Input label="Deskripsi" {...register("description")} />
        <Input label="Urutan" type="number" {...register("sort_order")} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={loading}>Simpan</Button>
        </div>
      </form>
    </Modal>
  );
}