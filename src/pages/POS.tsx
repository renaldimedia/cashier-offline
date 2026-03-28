// src/pages/POS.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import clsx from "clsx";

import { api, Category, Product, ProductPage, ProductQuery } from "../lib/tauri";
import { useCartStore } from "../store/cartStore";
import { Button, Input, Modal, PageHeader, formatCurrency } from "../components/ui";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { Grid } from "react-loader-spinner";



export default function POSPage() {
  const [result, setResult] = useState<ProductPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(window.innerWidth > 768);
  const searchRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1)
  const [width, setWidth] = useState(window.innerWidth);
  const { session, can } = useAuthStore();
  const [cats, setCats] = useState<Category[]>([]);
  const [loadingCat, setLoadingCat] = useState(false)
  const [selectedCat, setSelectedCat] = useState("")

  const loadCategories = async () => {
    setLoadingCat(true);
    const data = await api.categories.list().catch(() => []);
    setCats(data); setLoadingCat(false);
  };

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;

      setWidth(w);
      setCartOpen(w > 768); // trigger state lain
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const cart = useCartStore();

  // ── Fetch ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query: ProductQuery = {
        page,
        per_page: 100,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(selectedCat && { category_id: selectedCat })
      };
      const res = await api.products.list(query);
      setResult(res);
    } catch (e: unknown) {
      toast.error("Gagal memuat produk");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, selectedCat]);

  // Load products
  useEffect(() => {
    load()
    loadCategories();
    searchRef.current?.focus();
  }, []);

  const pageData = result?.data ?? [];

  useEffect(() => {
    load()
  }, [load])



  return (
    <div>

      <div className="flex h-full relative">

        {/* ── Product Grid ── */}
        <div className="flex-1 flex flex-col min-w-0">
          <PageHeader
            title={`Halo, ${session?.full_name} 👋`}
            subtitle={new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            actions={
              <Button onClick={() => setCartOpen(!cartOpen)} size="sm">
                {cartOpen && (<span>Sembunyikan</span>)}Keranjang {cart.items.length > 0 && !cartOpen && (
                  <span className="text-white bg-red-600 p-2 py-1 rounded-full m-0">{cart.items.length}</span>
                )}
              </Button>
            }
          />
          {/* Search bar */}
          <div className="px-4 py-3 border-b border-gray-100">
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari produk / scan barcode..."
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm outline-none focus:border-gray-500"
            />
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {cats.length > 0 && (
              <div className="w-full flex gap-2 flex-wrap mb-4">
                {cats.map((item) => (
                  <Button onClick={() => setSelectedCat(item.id)} className={`${selectedCat == item.id ? "text-white" : "text-black bg-transparent hover:text-white"} border`}>{item.name}</Button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {pageData.map((p) => (
                <button
                  key={p.id}
                  onClick={() => cart.addItem(p)}
                  disabled={p.stock <= 0}
                  className={clsx(
                    "text-left p-3 rounded-lg border transition-all",
                    p.stock > 0
                      ? "border-gray-200 hover:border-gray-400 hover:shadow-sm bg-white"
                      : "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="text-xs text-gray-400 mb-1">{p.sku}</div>
                  <div className="text-sm font-medium leading-snug line-clamp-2">{p.name}</div>
                  <div className="text-sm font-semibold mt-2">{formatCurrency(p.price)}</div>
                  <div className={clsx("text-xs mt-1", p.stock <= p.stock_min ? "text-red-500" : "text-gray-400")}>
                    Stok: {p.stock} {p.unit}
                  </div>
                </button>
              ))}
            </div>
            {loading && (
              <Grid
                visible={true}
                height="80"
                width="80"
                color="#4fa94d"
                ariaLabel="grid-loading"
                radius="12.5"
                wrapperStyle={{}}
                wrapperClass="grid-wrapper"
              />
            )}
            {pageData.length === 0 && (
              <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                Produk tidak ditemukan
              </div>
            )}
          </div>
        </div>


        {/* ── Cart ── */}
        <aside className={`
          h-screen w-80 xl:w-96 flex flex-col
          bg-white border-l border-gray-200
          transition-transform duration-300 ease-in-out
          ${cartOpen ? "translate-x-0" : "translate-x-full fixed right-0 top-0 "}
        `}>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-medium text-sm">Keranjang</span>
            {cart.items.length > 0 && (
              <button onClick={cart.clear} className="text-xs text-gray-400 hover:text-red-500">
                Hapus semua
              </button>
            )}
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto">
            {cart.items.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                Belum ada item
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {cart.items.map((item) => (
                  <CartRow key={item.product.id} item={item} />
                ))}
              </div>
            )}
          </div>

          {/* Summary + Checkout */}
          <div className="border-t border-gray-100 p-4 space-y-3">
            {/* Discount */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 w-20 shrink-0">Diskon</label>
              <input
                type="number"
                min={0}
                value={cart.discount || ""}
                onChange={(e) => cart.setDiscount(Number(e.target.value))}
                placeholder="0"
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm text-right outline-none"
              />
            </div>

            {/* Totals */}
            <div className="space-y-1 pt-1">
              <Row label="Subtotal" value={formatCurrency(cart.subtotal())} />
              {cart.discount > 0 && <Row label="Diskon" value={`-${formatCurrency(cart.discount)}`} />}
              {cart.tax_rate > 0 && <Row label={`Pajak (${cart.tax_rate}%)`} value={formatCurrency(cart.totalTax())} />}
              <div className="flex justify-between pt-2 border-t border-gray-100">
                <span className="font-semibold text-sm">Total</span>
                <span className="font-bold text-base">{formatCurrency(cart.grandTotal())}</span>
              </div>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={cart.items.length === 0}
              onClick={() => setCheckoutOpen(true)}
            >
              Bayar
            </Button>
          </div>
        </aside>


        {/* Checkout modal */}
        <CheckoutModal
          open={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          onDone={() => {
            setCheckoutOpen(false);
            setSearch("");
          }}
        />
      </div>
    </div>

  );
}

// ─── Cart Row ─────────────────────────────────
function CartRow({ item }: { item: import("../store/cartStore").CartItem }) {
  const { updateQty, removeItem } = useCartStore();
  return (
    <div className="flex items-start gap-2 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{item.product.name}</p>
        <p className="text-xs text-gray-400">{formatCurrency(item.unit_price)} / {item.product.unit}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => updateQty(item.product.id, item.qty - 1)}
          className="w-6 h-6 border border-gray-300 rounded text-xs hover:bg-gray-100"
        >−</button>
        <span className="w-8 text-center text-sm">{item.qty}</span>
        <button
          onClick={() => updateQty(item.product.id, item.qty + 1)}
          disabled={item.qty >= item.product.stock}
          className="w-6 h-6 border border-gray-300 rounded text-xs hover:bg-gray-100 disabled:opacity-40"
        >+</button>
        <button onClick={() => removeItem(item.product.id)} className="ml-1 text-gray-300 hover:text-red-400 text-sm">×</button>
      </div>
    </div>
  );
}

// ─── Checkout Modal ───────────────────────────
function CheckoutModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const cart = useCartStore();
  const [method, setMethod] = useState<"cash" | "card" | "qris" | "transfer">("cash");
  const [paid, setPaid] = useState("");
  const [loading, setLoading] = useState(false);

  const total = cart.grandTotal();
  const paidAmt = Number(paid) || 0;
  const change = Math.max(0, paidAmt - total);

  const handlePay = async () => {
    if (method === "cash" && paidAmt < total) {
      toast.error("Jumlah bayar kurang");
      return;
    }
    setLoading(true);
    try {
      await api.transactions.create({
        discount_amount: cart.discount,
        tax_rate: cart.tax_rate,
        customer_id: cart.customer_id,
        customer_name: cart.customer_name,
        notes: cart.notes,
        items: cart.items.map((i) => ({
          product_id: i.product.id,
          qty: i.qty,
          unit_price: i.unit_price,
          discount_pct: i.discount_pct,
        })),
        payments: [{
          method,
          amount: paidAmt > 0 ? paidAmt : total,
          change_amount: change,
        }],
      });
      toast.success("Transaksi berhasil!");
      cart.clear();
      setPaid("");
      onDone();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Transaksi gagal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Pembayaran">
      <div className="space-y-4">
        <div className="flex justify-between text-sm font-semibold">
          <span>Total Pembayaran</span>
          <span className="text-lg">{formatCurrency(total)}</span>
        </div>

        {/* Payment method */}
        <div className="grid grid-cols-4 gap-2">
          {(["cash", "card", "qris", "transfer"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={clsx(
                "py-2 text-xs rounded border capitalize transition-colors",
                method === m ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 hover:border-gray-400"
              )}
            >{m === "cash" ? "Tunai" : m === "card" ? "Kartu" : m.toUpperCase()}</button>
          ))}
        </div>

        {method === "cash" && (
          <div className="space-y-2">
            <Input
              label="Uang diterima"
              type="number"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              placeholder={String(total)}
              autoFocus
            />
            {paidAmt > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Kembalian</span>
                <span className="font-semibold text-green-600">{formatCurrency(change)}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Batal</Button>
          <Button className="flex-1" loading={loading} onClick={handlePay}>Proses</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Helper ───────────────────────────────────
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs text-gray-500">
      <span>{label}</span><span>{value}</span>
    </div>
  );
}