// src/lib/tauri.ts
// Type-safe wrappers around Tauri invoke calls

import { invoke } from "@tauri-apps/api/core";

// ─────────────────────────────────────────────
// Generic response type from Rust backend
// ─────────────────────────────────────────────
export interface ApiResponse<T> {
    success: boolean;
    data: T | null;
    error: string | null;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const res: ApiResponse<T> = await invoke(cmd, args);
    if (!res.success || res.data === null) {
        throw new Error(res.error ?? `Command ${cmd} failed`);
    }
    return res.data;
}

// ─────────────────────────────────────────────
// Types (mirroring Rust structs)
// ─────────────────────────────────────────────
export interface Session {
    user_id: string;
    username: string;
    full_name: string;
    role: "superadmin" | "manager" | "cashier";
    logged_in_at: string;
}

export interface User {
    id: string; username: string; role: string;
    full_name: string; is_active: boolean;
    created_at: string; updated_at: string;
}

export interface ProductQuery {
    // pagination
    page?: number;
    per_page?: number;
    // filters
    search?: string;
    category_id?: string;
    status?: "active" | "inactive";
    stock_level?: "low" | "zero" | "ok";
    sync_status?: "synced" | "local";
    // sort
    sort_by?: "name" | "sku" | "price" | "cost" | "stock" | "category_id" | "created_at" | "updated_at";
    sort_dir?: "asc" | "desc";
}

export interface ProductPage {
    data: Product[];
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
}

export interface Product {
    id: string; sku: string; barcode?: string; name: string;
    description: string; category_id?: string; price: number;
    cost: number; stock: number; stock_min: number; unit: string;
    is_active: boolean; ext_id?: string; synced_at?: string;
    created_at: string; updated_at: string;
}

export interface Category {
    id: string; name: string; description: string;
    sort_order: number; is_active: boolean;
    created_at: string; updated_at: string;
}

export interface Customer {
    id: string; name: string; phone?: string; email?: string;
    address: string; notes: string; is_active: boolean;
    created_at: string; updated_at: string;
}

export interface TransactionItem {
    product_id: string; product_sku: string; product_name: string;
    qty: number; unit: string; unit_price: number;
    discount_pct: number; discount_amount: number; total: number;
}

// export interface Transaction {
//     id?: string; 
//     customer_id?:string;
//     customer_name?:string;
//     cashier_id?:string;
//     cashier_name?:string;
//     total?:number;
//     payments?: Payment[];
//     synced_at?: string;
//     created_at: string; updated_at: string;
// }
export interface TransactionPage {
    data: any[];
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
}

export interface DataPaging {
    data: any[];
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
}

export interface TransactionQuery {
    // pagination
    page?: number;
    per_page?: number;
    // filters
    search?: string;
    customer_id?: string;
    cashier_id?: string;
    status?: "pending" | "completed";
    sync_status?: "synced" | "local";
    // sort
    sort_by?: "invoice_no" | "total" | "cashier_name" | "customer_name" | "created_at";
    sort_dir?: "asc" | "desc";
}


export interface Payment {
    method: "cash" | "card" | "qris" | "transfer" | "other";
    amount: number; change_amount: number; reference_no?: string;
}

export interface CreateTransactionPayload {
    customer_id?: string; customer_name?: string;
    discount_amount?: number; tax_rate?: number; notes?: string;
    items: { product_id: string; qty: number; unit_price: number; discount_pct?: number }[];
    payments: Payment[];
}

export interface Setting {
    key: string; value: string; value_type: string;
    description: string; is_public: boolean; updated_at: string;
}

export interface SyncSource {
    id: string; name: string; direction: "inbound" | "outbound";
    entity_type: string; base_url: string; endpoint: string;
    http_method: string; auth_type: string; is_active: boolean;
    sync_interval: number; last_sync_at?: string;
    last_sync_status?: string; last_sync_msg?: string;
    created_at: string; updated_at: string;
}

export interface FieldMapping {
    id: string; source_id: string; api_field: string;
    local_field: string; transform?: string; default_value?: string;
    is_required: boolean; sort_order: number;
}

export interface CategoryQuery {
    // pagination
    page?: number;
    per_page?: number;
    // filters
    search?: string;
    sync_status?: "synced" | "local";
    // sort
    sort_by?: "name" | "created_at" | "sort_order";
    sort_dir?: "asc" | "desc";
}

// ─────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────
export const api = {
    auth: {
        login: (username: string, password: string) =>
            call<{ session: Session }>("cmd_login", { payload: { username, password } }),
        logout: () => call<null>("cmd_logout"),
        getSession: () => call<Session>("cmd_get_session"),
    },

    // ─── Users ───────────────────────────────
    users: {
        list: () => call<User[]>("cmd_list_users"),
        create: (p: { username: string; password: string; role: string; full_name: string }) =>
            call<User>("cmd_create_user", { payload: p }),
        update: (p: { id: string; full_name?: string; is_active?: boolean }) =>
            call<null>("cmd_update_user", { payload: p }),
        delete: (id: string) => call<null>("cmd_delete_user", { id }),
        changePassword: (p: { user_id: string; old_password: string; new_password: string }) =>
            call<null>("cmd_change_password", { payload: p }),
    },

    // ─── Products ────────────────────────────
    products: {
        /** Paginated + filtered list.  All params are optional. */
        list: (query?: ProductQuery) =>
            call<ProductPage>("cmd_list_products", { query }),
        get: (id: string) => call<Product>("cmd_get_product", { id }),
        search: (query: string) => call<Product[]>("cmd_search_products", { query }),
        create: (p: Partial<Product> & { sku: string; name: string; price: number }) =>
            call<Product>("cmd_create_product", { payload: p }),
        update: (p: Partial<Product> & { id: string }) =>
            call<Product>("cmd_update_product", { payload: p }),
        delete: (id: string) => call<null>("cmd_delete_product", { id }),
    },

    // ─── Categories ──────────────────────────
    categories: {
        list: (query: CategoryQuery) => call<Category[]>("cmd_list_categories", {query}),
        create: (p: { name: string; description?: string; sort_order?: number }) =>
            call<null>("cmd_create_category", { payload: p }),
        update: (id: string, p: { name: string; description?: string; sort_order?: number }) =>
            call<null>("cmd_update_category", { id, payload: p }),
        delete: (id: string) => call<null>("cmd_delete_category", { id }),
    },

    // ─── Customers ───────────────────────────
    customers: {
        list: (query?: string) => call<Customer[]>("cmd_list_customers", { query }),
        create: (p: { name: string; phone?: string; email?: string; address?: string; notes?: string }) =>
            call<string>("cmd_create_customer", { payload: p }),
        update: (id: string, p: { name: string; phone?: string; email?: string; address?: string; notes?: string }) =>
            call<null>("cmd_update_customer", { id, payload: p }),
    },

    // ─── Transactions ────────────────────────
    transactions: {
        create: (p: CreateTransactionPayload) =>
            call<TransactionItem>("cmd_create_transaction", { payload: p }),
        list: (query?: TransactionQuery) =>
            call<unknown[]>("cmd_list_transactions", { query }),
        get: (id: string) => call<unknown>("cmd_get_transaction", { id }),
        void: (id: string, reason: string) =>
            call<null>("cmd_void_transaction", { id, reason }),
        voids: (ids: string, reason: string) =>
            call<null>("cmd_void_transaction", { ids, reason }),
        months: () => call<string[]>("cmd_list_tx_months"),
    },

    // ─── Settings ────────────────────────────
    settings: {
        list: () => call<Setting[]>("cmd_get_settings"),
        get: (key: string) => call<string>("cmd_get_setting", { key }),
        update: (key: string, value: string) =>
            call<null>("cmd_update_setting", { payload: { key, value } }),
    },

    // ─── Sync ────────────────────────────────
    sync: {
        listSources: () => call<SyncSource[]>("cmd_list_sync_sources"),
        createSource: (p: Record<string, unknown>) => call<string>("cmd_create_sync_source", { payload: p }),
        updateSource: (id: string, isActive?: boolean, syncInterval?: number) =>
            call<null>("cmd_update_sync_source", { id, isActive, syncInterval }),
        deleteSource: (id: string) => call<null>("cmd_delete_sync_source", { id }),
        listMappings: (sourceId: string) => call<FieldMapping[]>("cmd_list_field_mappings", { sourceId }),
        saveMappings: (sourceId: string, mappings: Partial<FieldMapping>[]) =>
            call<null>("cmd_save_field_mappings", { sourceId, mappings }),
        run: (sourceId: string) => call<unknown>("cmd_run_sync", { sourceId }),
        queueStats: () => call<Record<string, number>>("cmd_get_sync_queue_stats"),
    },
};