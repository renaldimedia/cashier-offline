// src/App.tsx
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { useAuthStore } from "./store/authStore";
import { api } from "./lib/tauri";

import LoginPage       from "./pages/Login.tsx";
import Layout          from "./components/layout/Layout.tsx";
import DashboardPage   from "./pages/Dashboard.tsx";
import POSPage         from "./pages/POS.tsx";
import ProductsPage    from "./pages/Products.tsx";
import CategoriesPage  from "./pages/Categories.tsx";
import TransactionsPage from "./pages/Transactions.tsx";
import SettingsPage    from "./pages/Settings.tsx";
import SyncPage        from "./pages/Sync.tsx";
import UsersPage       from "./pages/Users.tsx";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session);
  return session ? <>{children}</> : <Navigate to="/login" replace />;
}

function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  const can = useAuthStore((s) => s.can);
  return can(role) ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const { session, setSession } = useAuthStore();

  // Restore session on mount
  useEffect(() => {
    if (!session) return;
    api.auth.getSession()
      .then((s) => setSession(s))
      .catch(() => setSession(null));
  }, []);

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{ duration: 3000,
          style: { fontSize: "0.875rem" }
        }}
      />
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route path="/" element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }>
          <Route index element={<DashboardPage />} />
          <Route path="pos" element={<POSPage />} />
          <Route path="products" element={
            <RequireRole role="manage_products">
              <ProductsPage />
            </RequireRole>
          }/>
          <Route path="categories" element={
            <RequireRole role="manage_products">
              <CategoriesPage />
            </RequireRole>
          }/>
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="settings" element={
            <RequireRole role="manage_settings">
              <SettingsPage />
            </RequireRole>
          }/>
          <Route path="sync" element={
            <RequireRole role="configure_sync">
              <SyncPage />
            </RequireRole>
          }/>
          <Route path="users" element={
            <RequireRole role="manage_users">
              <UsersPage />
            </RequireRole>
          }/>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}