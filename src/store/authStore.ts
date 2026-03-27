// src/store/authStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Session } from "../lib/tauri";

interface AuthState {
  session: Session | null;
  setSession: (s: Session | null) => void;
  can: (action: string) => boolean;
}

const PERMISSIONS: Record<string, string[]> = {
  manage_users:    ["superadmin"],
  manage_settings: ["superadmin"],
  configure_sync:  ["superadmin"],
  delete_product:  ["superadmin"],
  manage_products: ["superadmin", "manager"],
  view_reports:    ["superadmin", "manager"],
  void_transaction:["superadmin", "manager"],
  pos:             ["superadmin", "manager", "cashier"],
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      setSession: (session) => set({ session }),
      can: (action) => {
        const role = get().session?.role;
        if (!role) return false;
        return PERMISSIONS[action]?.includes(role) ?? false;
      },
    }),
    { name: "pos-auth" }
  )
);