// src/components/layout/Layout.tsx
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { api } from "../../lib/tauri";
import toast from "react-hot-toast";
import clsx from "clsx";

interface NavItem {
  to:    string;
  label: string;
  icon:  string;
  perm?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/",            label: "Dashboard",    icon: "⊞" },
  { to: "/pos",         label: "Kasir",        icon: "🛒", perm: "pos" },
  { to: "/transactions",label: "Transaksi",    icon: "📋" },
  { to: "/products",    label: "Produk",       icon: "📦", perm: "manage_products" },
  { to: "/categories",  label: "Kategori",     icon: "🏷",  perm: "manage_products" },
  { to: "/users",       label: "Pengguna",     icon: "👤",  perm: "manage_users" },
  { to: "/sync",        label: "Sinkronisasi", icon: "🔄",  perm: "configure_sync" },
  { to: "/settings",    label: "Pengaturan",   icon: "⚙",  perm: "manage_settings" },
];

export default function Layout() {
  const { session, can, setSession } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await api.auth.logout().catch(() => {});
    setSession(null);
    navigate("/login");
    toast.success("Logout berhasil");
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* Sidebar */}
      <aside className="w-52 flex flex-col bg-white border-r border-gray-200 shrink-0">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-gray-100">
          <h1 className="font-semibold text-base tracking-tight">POS App</h1>
          <p className="text-xs text-gray-400 mt-0.5 capitalize">{session?.role}</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV_ITEMS.filter((item) => !item.perm || can(item.perm)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => clsx(
                "flex items-center gap-2.5 px-5 py-2 text-sm transition-colors",
                isActive
                  ? "bg-gray-100 text-gray-900 font-medium"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
              )}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-gray-100">
          <p className="text-xs text-gray-500 truncate">{session?.full_name}</p>
          <button
            onClick={handleLogout}
            className="mt-2 text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}