// src/components/ui/index.tsx
// Minimal, unstyled-ish UI primitives — style will be finalized later

import React from "react";
import clsx from "clsx";

// ─── Button ──────────────────────────────────
interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?:    "sm" | "md" | "lg";
  loading?: boolean;
}

export function Button({
  variant = "primary", size = "md", loading, disabled, children, className, ...props
}: BtnProps) {
  const base = "inline-flex items-center justify-center gap-1.5 font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary:   "bg-gray-900 text-white hover:bg-gray-700 focus:ring-gray-900",
    secondary: "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 focus:ring-gray-300",
    danger:    "bg-red-600 text-white hover:bg-red-700 focus:ring-red-600",
    ghost:     "text-gray-600 hover:bg-gray-100 focus:ring-gray-200",
  };
  const sizes = {
    sm:  "px-2.5 py-1.5 text-xs",
    md:  "px-3.5 py-2 text-sm",
    lg:  "px-5 py-2.5 text-base",
  };
  return (
    <button
      disabled={disabled || loading}
      className={clsx(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {loading && <span className="animate-spin text-xs">⟳</span>}
      {children}
    </button>
  );
}

// ─── Input ───────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?:  string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, ...props }, ref) => (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-gray-600">{label}</label>}
      <input
        ref={ref}
        className={clsx(
          "rounded border px-3 py-2 text-sm outline-none transition-colors",
          "placeholder:text-gray-400",
          error
            ? "border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-500"
            : "border-gray-300 focus:border-gray-500 focus:ring-1 focus:ring-gray-400",
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  )
);
Input.displayName = "Input";

// ─── Select ──────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, children, className, ...props }, ref) => (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-gray-600">{label}</label>}
      <select
        ref={ref}
        className={clsx(
          "rounded border px-3 py-2 text-sm outline-none transition-colors bg-white",
          error ? "border-red-400" : "border-gray-300 focus:border-gray-500 focus:ring-1 focus:ring-gray-400",
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
);
Select.displayName = "Select";

// ─── Badge ───────────────────────────────────
interface BadgeProps { label: string; color?: "gray" | "green" | "red" | "yellow" | "blue" }

export function Badge({ label, color = "gray" }: BadgeProps) {
  const colors = {
    gray:   "bg-gray-100 text-gray-600",
    green:  "bg-green-100 text-green-700",
    red:    "bg-red-100 text-red-600",
    yellow: "bg-yellow-100 text-yellow-700",
    blue:   "bg-blue-100 text-blue-700",
  };
  return (
    <span className={clsx("inline-block text-xs px-2 py-0.5 rounded-full font-medium", colors[color])}>
      {label}
    </span>
  );
}

// ─── Modal ───────────────────────────────────
interface ModalProps {
  open:     boolean;
  onClose:  () => void;
  title:    string;
  children: React.ReactNode;
  width?:   string;
}

export function Modal({ open, onClose, title, children, width = "max-w-lg" }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={clsx("relative bg-white rounded-lg shadow-xl w-full mx-4", width)}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Card ────────────────────────────────────
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("bg-white rounded-lg border border-gray-200", className)}>
      {children}
    </div>
  );
}

// ─── Page Header ─────────────────────────────
export function PageHeader({ title, subtitle, actions }: {
  title: string; subtitle?: string; actions?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100">
      <div>
        <h1 className="font-semibold text-base text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ─── Empty State ─────────────────────────────
export function EmptyState({ message, icon = "📭" }: { message: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <span className="text-4xl mb-3">{icon}</span>
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ─── Loading ─────────────────────────────────
export function Loading() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
    </div>
  );
}

// ─── Currency formatter (Indonesia) ──────────
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(amount);
}

export function formatDate(datestr: string, lang: string = "id-ID"): string {
  if (!datestr) return "";

  const date = new Date(datestr);
  if (isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(lang, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}