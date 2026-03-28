// src/pages/Products.tsx
// Products table — server-side filter, sort, pagination via cmd_list_products

import { useEffect, useState, useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import clsx from "clsx";

import { api, Product, ProductQuery, ProductPage, Category } from "../lib/tauri";
import { Button, Input, Select, Modal, PageHeader, EmptyState, Loading, formatCurrency } from "../components/ui";

// ─────────────────────────────────────────────
// Column definitions
// ─────────────────────────────────────────────
type ColKey = "sku" | "name" | "category" | "price" | "cost" | "stock" | "unit" | "status" | "sync";
type SortableKey = Extract<ProductQuery["sort_by"], string>;

interface ColDef {
  key: ColKey;
  label: string;
  visible: boolean;
  sortBy?: SortableKey;   // undefined = not sortable
  align?: "right";
  width?: string;
}

const DEFAULT_COLS: ColDef[] = [
  { key: "sku", label: "SKU", visible: true, sortBy: "sku", width: "w-24" },
  { key: "name", label: "Nama Produk", visible: true, sortBy: "name" },
  { key: "category", label: "Kategori", visible: true, sortBy: "category_id", width: "w-28" },
  { key: "price", label: "Harga Jual", visible: true, sortBy: "price", align: "right", width: "w-28" },
  { key: "cost", label: "Harga Modal", visible: true, sortBy: "cost", align: "right", width: "w-24" },
  { key: "stock", label: "Stok", visible: true, sortBy: "stock", align: "right", width: "w-20" },
  { key: "unit", label: "Satuan", visible: true, width: "w-16" },
  { key: "status", label: "Status", visible: true, width: "w-20" },
  { key: "sync", label: "Sync", visible: true, width: "w-20" },
];

const PAGE_SIZES = [10, 25, 50, 100];

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

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────
export default function ProductsPage() {
  // Server data
  const [result, setResult] = useState<ProductPage | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null | "new">(null);

  // Query state (maps 1-to-1 to ProductQuery)
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("");
  const [filterSt, setFilterSt] = useState<string>("");
  const [filterStk, setFilterStk] = useState<string>("");
  const [filterSync, setFilterSync] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortableKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
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
  useEffect(() => { setPage(1); }, [debouncedSearch, filterCat, filterSt, filterStk, filterSync, sortBy, sortDir, perPage]);

  // ── Fetch ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query: ProductQuery = {
        page,
        per_page: perPage,
        sort_by: sortBy,
        sort_dir: sortDir,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(filterCat && { category_id: filterCat }),
        ...(filterSt as ProductQuery["status"] && { status: filterSt as ProductQuery["status"] }),
        ...(filterStk as ProductQuery["stock_level"] && { stock_level: filterStk as ProductQuery["stock_level"] }),
        ...(filterSync as ProductQuery["sync_status"] && { sync_status: filterSync as ProductQuery["sync_status"] }),
      };
      const res = await api.products.list(query);
      setResult(res);
    } catch (e: unknown) {
      toast.error("Gagal memuat produk");
    } finally {
      setLoading(false);
    }
  }, [page, perPage, debouncedSearch, filterCat, filterSt, filterStk, filterSync, sortBy, sortDir]);

  useEffect(() => { load(); }, [load]);

  // Load categories once
  useEffect(async () => {
    const res = await api.categories.list({page: 1, per_page: 1000});
    setCategories(res?.data ?? [])
  }, []);

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

  // ── Bulk deactivate ───────────────────────────────────────
  const handleBulkDeactivate = async () => {
    if (!confirm(`Nonaktifkan ${selected.size} produk?`)) return;
    await Promise.all([...selected].map((id) => api.products.delete(id)));
    toast.success(`${selected.size} produk dinonaktifkan`);
    clearSelection();
    load();
  };

  // ── Delete single ─────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm("Nonaktifkan produk ini?")) return;
    await api.products.delete(id);
    toast.success("Produk dinonaktifkan");
    load();
  };

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
  const catName = (id?: string) => categories.find((c) => c.id === id)?.name ?? "—";

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
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PageHeader
        title="Produk"
        subtitle={
          result
            ? `${result.total.toLocaleString("id-ID")} produk ditemukan`
            : "Memuat…"
        }
        actions={<Button onClick={() => setEditing("new")}>+ Tambah</Button>}
      />

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
        <Chip value={filterCat} onChange={(v) => setFilterCat(v)}>
          <option value="">Semua Kategori</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Chip>

        <Chip value={filterSt} onChange={(v) => setFilterSt(v)}>
          <option value="">Semua Status</option>
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
        </Chip>

        <Chip value={filterStk} onChange={(v) => setFilterStk(v)}>
          <option value="">Semua Stok</option>
          <option value="low">Stok Menipis</option>
          <option value="ok">Stok Aman</option>
          <option value="zero">Habis</option>
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
          <button onClick={handleBulkDeactivate}
            className="text-xs px-2.5 py-1 border border-blue-200 rounded bg-white text-blue-700 hover:bg-blue-50">
            Nonaktifkan
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
                const isLow = p.stock > 0 && p.stock <= p.stock_min;
                const isZero = p.stock === 0;
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

                        {col.key === "sku" && (
                          <span className="font-mono text-xs text-gray-500">{p.sku}</span>
                        )}
                        {col.key === "name" && (
                          <span className="font-medium" title={p.name}>{p.name}</span>
                        )}
                        {col.key === "category" && (
                          <span className="text-gray-500">{catName(p.category_id)}</span>
                        )}
                        {col.key === "price" && formatCurrency(p.price)}
                        {col.key === "cost" && (
                          <span className="text-gray-500">{formatCurrency(p.cost)}</span>
                        )}
                        {col.key === "stock" && (
                          <span className={clsx(
                            isZero && "text-red-600 font-semibold",
                            isLow && !isZero && "text-amber-600 font-medium"
                          )}>
                            {p.stock.toLocaleString("id-ID")}
                          </span>
                        )}
                        {col.key === "unit" && <span className="text-gray-500">{p.unit}</span>}
                        {col.key === "status" && <StatusBadge active={p.is_active} />}
                        {col.key === "sync" && <SyncBadge synced={!!p.synced_at} />}
                      </td>
                    ))}

                    {/* Actions — visible on row hover */}
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5 invisible group-hover:visible">
                        <button onClick={() => setEditing(p)}
                          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 text-gray-600">
                          Edit
                        </button>
                        {p.is_active && (
                          <button onClick={() => handleDelete(p.id)}
                            className="text-xs px-2 py-1 border border-red-200 rounded hover:bg-red-50 text-red-500">
                            ×
                          </button>
                        )}
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

      {/* Product modal */}
      {editing !== null && (
        <ProductModal
          product={editing === "new" ? null : editing}
          categories={categories}
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

// ─────────────────────────────────────────────
// Product form modal
// ─────────────────────────────────────────────
function ProductModal({ product, categories, onClose, onSaved }: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: product ?? {
      sku: "", name: "", barcode: "", description: "",
      category_id: "", price: 0, cost: 0,
      stock: 0, stock_min: 0, unit: "pcs",
    },
  });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: Record<string, unknown>) => {
    setLoading(true);
    try {
      data.price = Number(data.price)
      data.cost = Number(data.cost)
      data.stock = Number(data.stock)
      data.stock_min = Number(data.stock_min)

      if (product) {
        await api.products.update({ ...data, id: product.id } as Product);
      } else {
        await api.products.create(data as Parameters<typeof api.products.create>[0]);
      }
      toast.success(product ? "Produk diperbarui" : "Produk ditambahkan");
      onSaved();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan produk");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open title={product ? "Edit Produk" : "Tambah Produk"} onClose={onClose} width="max-w-lg">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="SKU *"   {...register("sku", { required: "SKU wajib diisi" })} error={errors.sku?.message} />
          <Input label="Barcode" {...register("barcode")} />
        </div>
        <Input label="Nama Produk *"
          {...register("name", { required: "Nama wajib diisi" })}
          error={errors.name?.message}
        />
        <Input label="Deskripsi" {...register("description")} />
        <Select label="Kategori" {...register("category_id")}>
          <option value="">— Pilih kategori —</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Harga Jual (Rp) *" type="number" step="0.01" min="0"
            {...register("price", { required: "Harga wajib diisi", valueAsNumber: true })}
            error={errors.price?.message}
          />
          <Input label="Harga Modal (Rp)" type="number" step="0.01" min="0"
            {...register("cost", { valueAsNumber: true })} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Input label="Stok" type="number" min="0" {...register("stock", { valueAsNumber: true })} />
          <Input label="Min. Stok" type="number" min="0" {...register("stock_min", { valueAsNumber: true })} />
          <Input label="Satuan"    {...register("unit")} placeholder="pcs" />
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
          <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={loading}>Simpan</Button>
        </div>
      </form>
    </Modal>
  );
}