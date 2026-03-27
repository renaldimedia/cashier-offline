// src/store/cartStore.ts
import { create } from "zustand";
import type { Product } from "../lib/tauri";

export interface CartItem {
  product:      Product;
  qty:          number;
  unit_price:   number;
  discount_pct: number;
  total:        number;
}

interface CartState {
  items:          CartItem[];
  discount:       number;   // global discount amount
  tax_rate:       number;   // %
  customer_id?:   string;
  customer_name?: string;
  notes:          string;

  addItem:        (product: Product) => void;
  removeItem:     (productId: string) => void;
  updateQty:      (productId: string, qty: number) => void;
  updateDiscount: (productId: string, pct: number) => void;
  setDiscount:    (amount: number) => void;
  setTaxRate:     (rate: number) => void;
  setCustomer:    (id?: string, name?: string) => void;
  setNotes:       (notes: string) => void;
  clear:          () => void;

  // Computed
  subtotal:  () => number;
  totalTax:  () => number;
  grandTotal:() => number;
}

const lineTotal = (item: CartItem) =>
  item.unit_price * item.qty * (1 - item.discount_pct / 100);

export const useCartStore = create<CartState>()((set, get) => ({
  items:    [],
  discount: 0,
  tax_rate: 0,
  notes:    "",

  addItem: (product) => set((s) => {
    const existing = s.items.find((i) => i.product.id === product.id);
    if (existing) {
      return {
        items: s.items.map((i) =>
          i.product.id === product.id
            ? { ...i, qty: i.qty + 1, total: lineTotal({ ...i, qty: i.qty + 1 }) }
            : i
        ),
      };
    }
    const newItem: CartItem = {
      product, qty: 1, unit_price: product.price,
      discount_pct: 0, total: product.price,
    };
    return { items: [...s.items, newItem] };
  }),

  removeItem: (productId) => set((s) => ({
    items: s.items.filter((i) => i.product.id !== productId),
  })),

  updateQty: (productId, qty) => set((s) => ({
    items: s.items
      .map((i) =>
        i.product.id === productId
          ? { ...i, qty, total: lineTotal({ ...i, qty }) }
          : i
      )
      .filter((i) => i.qty > 0),
  })),

  updateDiscount: (productId, pct) => set((s) => ({
    items: s.items.map((i) =>
      i.product.id === productId
        ? { ...i, discount_pct: pct, total: lineTotal({ ...i, discount_pct: pct }) }
        : i
    ),
  })),

  setDiscount:  (amount) => set({ discount: amount }),
  setTaxRate:   (rate)   => set({ tax_rate: rate }),
  setCustomer:  (id, name) => set({ customer_id: id, customer_name: name }),
  setNotes:     (notes)  => set({ notes }),
  clear:        () => set({ items: [], discount: 0, customer_id: undefined, customer_name: undefined, notes: "" }),

  subtotal:   () => get().items.reduce((sum, i) => sum + i.total, 0),
  totalTax:   () => {
    const { tax_rate, discount } = get();
    return Math.max(0, get().subtotal() - discount) * (tax_rate / 100);
  },
  grandTotal: () => Math.max(0, get().subtotal() - get().discount) + get().totalTax(),
}));