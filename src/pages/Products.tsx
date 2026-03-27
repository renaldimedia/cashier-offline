// src/pages/Products.tsx
// Products master table — sort, filter, pagination, column visibility, row selection

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import clsx from "clsx";

import { api, Product, Category } from "../lib/tauri";
import { Button, Input, Select, Modal, PageHeader, EmptyState, Loading, formatCurrency } from "../components/ui";

// ─────────────────────────────────────────────
// Column definition
// ─────────────────────────────────────────────
type ColKey = "sku" | "name" | "category" | "price" | "cost" | "stock" | "unit" | "status" | "sync";

interface ColDef {
  key:      ColKey;
  label:    string;
  visible:  boolean;
  sortable: boolean;
  align?:   "right";
  width?:   string;
}

const DEFAULT_COLS: ColDef[] = [
  { key: "sku",      label: "SKU",         visible: true,  sortable: true,  width: "w-24"  },
  { key: "name",     label: "Nama Produk", visible: true,  sortable: true                  },
  { key: "category", label: "Kategori",    visible: true,  sortable: true,  width: "w-28"  },
  { key: "price",    label: "Harga Jual",  visible: true,  sortable: true,  align: "right", width: "w-28" },
  { key: "cost",     label: "Harga Modal", visible: true,  sortable: true,  align: "right", width: "w-24" },
  { key: "stock",    label: "Stok",        visible: true,  sortable: true,  align: "right", width: "w-20" },
  { key: "unit",     label: "Satuan",      visible: true,  sortable: false, width: "w-16"  },
  { key: "status",   label: "Status",      visible: true,  sortable: true,  width: "w-20"  },
  { key: "sync",     label: "Sync",        visible: true,  sortable: false, width: "w-20"  },
];

type SortDir = 1 | -1;

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
// Main Page
// ─────────────────────────────────────────────
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export default function ProductsPage() {
  const [products,   setProducts]   = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editing,    setEditing]    = useState<Product | null | "new">(null);

  // Filters
  const [search,    setSearch]    = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterSt,  setFilterSt]  = useState("");    // "" | "active" | "inactive"
  const [filterStk, setFilterStk] = useState("");    // "" | "low" | "ok" | "zero"
  const [filterSync,setFilterSync]= useState("");    // "" | "synced" | "local"

  // Sort
  const [sortKey, setSortKey] = useState<ColKey | "">("");
  const [sortDir, setSortDir] = useState<SortDir>(1);

  // Pagination
  const [page,    setPage]    = useState(1);
  const [rpp,     setRpp]     = useState(20);

  // Row selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Column visibility
  const [cols, setCols] = useState<ColDef[]>(DEFAULT_COLS);
  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);

  // ── Load ─────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([api.products.list(false), api.categories.list()]);
      setProducts(p);
      setCategories(c);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close cols dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) {
        setColsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Filter + Sort ─────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let data = products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q) &&
          !(p.barcode ?? "").includes(q)) return false;
      if (filterCat && p.category_id !== filterCat) return false;
      if (filterSt === "active"   && !p.is_active) return false;
      if (filterSt === "inactive" &&  p.is_active) return false;
      if (filterStk === "low"  && !(p.stock > 0 && p.stock <= p.stock_min)) return false;
      if (filterStk === "ok"   && p.stock <= p.stock_min) return false;
      if (filterStk === "zero" && p.stock !== 0) return false;
      if (filterSync === "synced" && !p.synced_at) return false;
      if (filterSync === "local"  &&  p.synced_at) return false;
      return true;
    });

    if (sortKey) {
      data = [...data].sort((a, b) => {
        const av = a[sortKey as keyof Product] ?? "";
        const bv = b[sortKey as keyof Product] ?? "";
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
        return String(av).localeCompare(String(bv)) * sortDir;
      });
    }
    return data;
  }, [products, search, filterCat, filterSt, filterStk, filterSync, sortKey, sortDir]);

  // Reset to page 1 on filter change
  useEffect(() => setPage(1), [search, filterCat, filterSt, filterStk, filterSync]);

  // ── Pagination ────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / rpp));
  const safePage   = Math.min(page, totalPages);
  const pageData   = filtered.slice((safePage - 1) * rpp, safePage * rpp);
  const start      = filtered.length === 0 ? 0 : (safePage - 1) * rpp + 1;
  const end        = Math.min(safePage * rpp, filtered.length);

  // ── Sort toggle ───────────────────────────
  const handleSort = (key: ColKey) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  };

  // ── Selection ─────────────────────────────
  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      pageData.forEach((p) => { if (checked) next.add(p.id); else next.delete(p.id); });
      return next;
    });
  };
  const allOnPageSelected = pageData.length > 0 && pageData.every((p) => selected.has(p.id));
  const clearSelection = () => setSelected(new Set());

  // ── Bulk actions ──────────────────────────
  const handleBulkDeactivate = async () => {
    if (!confirm(`Nonaktifkan ${selected.size} produk?`)) return;
    await Promise.all([...selected].map((id) => api.products.delete(id)));
    toast.success(`${selected.size} produk dinonaktifkan`);
    clearSelection();
    load();
  };

  // ── Column visibility toggle ──────────────
  const toggleCol = (key: ColKey) => {
    setCols((prev) =>
      prev.map((c) => c.key === key ? { ...c, visible: !c.visible } : c)
    );
  };

  const visibleCols = cols.filter((c) => c.visible);

  // ── Category name lookup ──────────────────
  const catName = (id?: string) =>
    categories.find((c) => c.id === id)?.name ?? "—";

  // ── Delete single ─────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm("Nonaktifkan produk ini?")) return;
    await api.products.delete(id);
    toast.success("Produk dinonaktifkan");
    load();
  };

  // ── Page range helper ─────────────────────
  const pageRange = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "…")[] = [1];
    if (safePage > 3)           pages.push("…");
    for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++)
      pages.push(i);
    if (safePage < totalPages - 2) pages.push("…");
    pages.push(totalPages);
    return pages;
  };

  // ─────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PageHeader
        title="Produk"
        subtitle={`${filtered.length.toLocaleString("id-ID")} dari ${products.length} produk`}
        actions={<Button onClick={() => setEditing("new")}>+ Tambah</Button>}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-gray-100">
        {/* Search */}
        <div className="relative flex-1 min-w-44">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
               viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6.5" cy="6.5" r="4"/><path d="M10 10l3 3"/>
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama, SKU, barcode…"
            className="w-full pl-7 pr-3 py-1.5 text-sm border border-gray-300 rounded-md outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-300"
          />
        </div>

        {/* Filters */}
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
          className="h-8 text-sm border border-gray-300 rounded-md px-2 outline-none text-gray-600">
          <option value="">Semua Kategori</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select value={filterSt} onChange={(e) => setFilterSt(e.target.value)}
          className="h-8 text-sm border border-gray-300 rounded-md px-2 outline-none text-gray-600">
          <option value="">Semua Status</option>
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
        </select>

        <select value={filterStk} onChange={(e) => setFilterStk(e.target.value)}
          className="h-8 text-sm border border-gray-300 rounded-md px-2 outline-none text-gray-600">
          <option value="">Semua Stok</option>
          <option value="low">Stok Menipis</option>
          <option value="ok">Stok Aman</option>
          <option value="zero">Habis</option>
        </select>

        <select value={filterSync} onChange={(e) => setFilterSync(e.target.value)}
          className="h-8 text-sm border border-gray-300 rounded-md px-2 outline-none text-gray-600">
          <option value="">Semua Sync</option>
          <option value="synced">Synced</option>
          <option value="local">Lokal</option>
        </select>

        {/* Column visibility */}
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
                  <input
                    type="checkbox"
                    checked={col.visible}
                    onChange={() => toggleCol(col.key)}
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
        ) : filtered.length === 0 ? (
          <EmptyState message="Tidak ada produk yang cocok." />
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr>
                {/* Checkbox all */}
                <th className="w-9 px-3 py-2.5 border-b border-gray-200">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="w-3.5 h-3.5 cursor-pointer"
                  />
                </th>

                {visibleCols.map((col) => (
                  <th
                    key={col.key}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                    className={clsx(
                      "px-3 py-2.5 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wide select-none whitespace-nowrap",
                      col.width,
                      col.align === "right" && "text-right",
                      col.sortable && "cursor-pointer hover:text-gray-800"
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.sortable && (
                        <span className="text-gray-300 text-xs">
                          {sortKey === col.key ? (sortDir === 1 ? "▲" : "▼") : "▲"}
                        </span>
                      )}
                    </span>
                  </th>
                ))}

                {/* Actions */}
                <th className="w-24 px-3 py-2.5 border-b border-gray-200" />
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {pageData.map((p) => {
                const isLow  = p.stock > 0 && p.stock <= p.stock_min;
                const isZero = p.stock === 0;
                const isSel  = selected.has(p.id);

                return (
                  <tr
                    key={p.id}
                    className={clsx(
                      "transition-colors",
                      isSel ? "bg-blue-50" : "hover:bg-gray-50"
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleRow(p.id)}
                        className="w-3.5 h-3.5 cursor-pointer"
                      />
                    </td>

                    {visibleCols.map((col) => (
                      <td key={col.key}
                        className={clsx(
                          "px-3 py-2.5 max-w-0",
                          col.align === "right" && "text-right"
                        )}>

                        {col.key === "sku" && (
                          <span className="font-mono text-xs text-gray-500">{p.sku}</span>
                        )}
                        {col.key === "name" && (
                          <span className="font-medium truncate block" title={p.name}>{p.name}</span>
                        )}
                        {col.key === "category" && (
                          <span className="text-gray-500 truncate block">{catName(p.category_id)}</span>
                        )}
                        {col.key === "price" && formatCurrency(p.price)}
                        {col.key === "cost" && (
                          <span className="text-gray-500">{formatCurrency(p.cost)}</span>
                        )}
                        {col.key === "stock" && (
                          <span className={clsx(
                            isZero && "text-red-600 font-semibold",
                            isLow  && !isZero && "text-amber-600 font-medium"
                          )}>
                            {p.stock.toLocaleString("id-ID")}
                          </span>
                        )}
                        {col.key === "unit" && (
                          <span className="text-gray-500">{p.unit}</span>
                        )}
                        {col.key === "status" && <StatusBadge active={p.is_active} />}
                        {col.key === "sync"   && <SyncBadge synced={!!p.synced_at} />}
                      </td>
                    ))}

                    {/* Actions */}
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setEditing(p)}
                          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 text-gray-600"
                        >
                          Edit
                        </button>
                        {p.is_active && (
                          <button
                            onClick={() => handleDelete(p.id)}
                            className="text-xs px-2 py-1 border border-red-200 rounded hover:bg-red-50 text-red-500"
                          >
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
      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-white gap-4 flex-wrap">
          {/* Rows per page */}
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            Tampilkan
            <select
              value={rpp}
              onChange={(e) => { setRpp(Number(e.target.value)); setPage(1); }}
              className="h-7 text-xs border border-gray-300 rounded px-1.5 outline-none"
            >
              {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            baris
          </div>

          {/* Page info */}
          <span className="text-xs text-gray-500">
            {start}–{end} dari {filtered.length.toLocaleString("id-ID")} produk
          </span>

          {/* Page buttons */}
          <div className="flex items-center gap-1">
            <PageBtn onClick={() => setPage((p) => p - 1)} disabled={safePage <= 1}>‹</PageBtn>
            {pageRange().map((pg, i) =>
              pg === "…" ? (
                <span key={`e${i}`} className="px-1 text-xs text-gray-400">…</span>
              ) : (
                <PageBtn key={pg} onClick={() => setPage(pg as number)} current={pg === safePage}>
                  {pg}
                </PageBtn>
              )
            )}
            <PageBtn onClick={() => setPage((p) => p + 1)} disabled={safePage >= totalPages}>›</PageBtn>
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
// Page button
// ─────────────────────────────────────────────
function PageBtn({
  children, onClick, disabled, current,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  current?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "w-7 h-7 text-xs rounded flex items-center justify-center border transition-colors",
        current
          ? "bg-gray-900 text-white border-gray-900"
          : "border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default"
      )}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────
// Product form modal
// ─────────────────────────────────────────────
function ProductModal({
  product, categories, onClose, onSaved,
}: {
  product:    Product | null;
  categories: Category[];
  onClose:    () => void;
  onSaved:    () => void;
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
          <Input label="SKU *"    {...register("sku",  { required: "SKU wajib diisi" })} error={errors.sku?.message} />
          <Input label="Barcode"  {...register("barcode")} />
        </div>
        <Input
          label="Nama Produk *"
          {...register("name", { required: "Nama wajib diisi" })}
          error={errors.name?.message}
        />
        <Input label="Deskripsi" {...register("description")} />
        <Select label="Kategori" {...register("category_id")}>
          <option value="">— Pilih kategori —</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Harga Jual (Rp) *"
            type="number" step="0.01" min="0"
            {...register("price", { required: "Harga wajib diisi", valueAsNumber: true })}
            error={errors.price?.message}
          />
          <Input label="Harga Modal (Rp)" type="number" step="0.01" min="0"
            {...register("cost", { valueAsNumber: true })} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Input label="Stok"          type="number" min="0" {...register("stock",     { valueAsNumber: true })} />
          <Input label="Min. Stok"     type="number" min="0" {...register("stock_min", { valueAsNumber: true })} />
          <Input label="Satuan"        {...register("unit")} placeholder="pcs" />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
          <Button type="button" variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={loading}>Simpan</Button>
        </div>
      </form>
    </Modal>
  );
}