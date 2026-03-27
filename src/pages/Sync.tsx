// src/pages/Sync.tsx
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { useForm, useFieldArray } from "react-hook-form";

import { api, SyncSource, FieldMapping } from "../lib/tauri";
import {
  Button, Input, Select, Modal, Badge, Card,
  PageHeader, EmptyState, Loading, formatCurrency
} from "../components/ui";

type SyncStatus = "ok" | "error" | null | undefined;

function statusColor(s: SyncStatus) {
  if (s === "ok")    return "green";
  if (s === "error") return "red";
  return "gray";
}

export default function SyncPage() {
  const [sources, setSources]       = useState<SyncSource[]>([]);
  const [loading, setLoading]       = useState(true);
  const [addOpen, setAddOpen]       = useState(false);
  const [mapSource, setMapSource]   = useState<SyncSource | null>(null);
  const [stats, setStats]           = useState<Record<string, number>>({});
  const [running, setRunning]       = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [srcs, q] = await Promise.all([api.sync.listSources(), api.sync.queueStats()]);
      setSources(srcs);
      setStats(q);
    } catch (e: unknown) {
      toast.error("Gagal memuat data sync");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRun = async (id: string) => {
    setRunning(id);
    try {
      await api.sync.run(id);
      toast.success("Sync berhasil dijalankan");
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Sync gagal");
    } finally {
      setRunning(null);
    }
  };

  const handleToggle = async (s: SyncSource) => {
    await api.sync.updateSource(s.id, !s.is_active);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus sync source ini?")) return;
    await api.sync.deleteSource(id);
    toast.success("Dihapus");
    load();
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Sinkronisasi"
        subtitle="Kelola koneksi API untuk sync data"
        actions={<Button onClick={() => setAddOpen(true)}>+ Tambah Source</Button>}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Queue stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { key: "pending",  label: "Antrian",  color: "yellow" },
            { key: "done",     label: "Terkirim", color: "green"  },
            { key: "failed",   label: "Gagal",    color: "red"    },
            { key: "syncing",  label: "Proses",   color: "blue"   },
          ].map(({ key, label, color }) => (
            <Card key={key} className="p-4 text-center">
              <div className="text-2xl font-bold">{stats[key] ?? 0}</div>
              <div className="text-xs text-gray-400 mt-1">{label}</div>
            </Card>
          ))}
        </div>

        {/* Sources list */}
        {loading ? <Loading /> : sources.length === 0 ? (
          <EmptyState message="Belum ada sync source" icon="🔄" />
        ) : (
          <div className="space-y-3">
            {sources.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{s.name}</span>
                      <Badge label={s.direction === "inbound" ? "Masuk" : "Keluar"}
                             color={s.direction === "inbound" ? "blue" : "green"} />
                      <Badge label={s.entity_type} color="gray" />
                      {!s.is_active && <Badge label="Nonaktif" color="red" />}
                    </div>
                    <p className="text-xs text-gray-400 truncate">{s.base_url}{s.endpoint}</p>
                    {s.last_sync_at && (
                      <p className="text-xs text-gray-400 mt-1">
                        Sync terakhir: {new Date(s.last_sync_at).toLocaleString("id-ID")}
                        {" — "}
                        <Badge
                          label={s.last_sync_status ?? "—"}
                          color={statusColor(s.last_sync_status as SyncStatus)}
                        />
                      </p>
                    )}
                    {s.last_sync_msg && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">{s.last_sync_msg}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="secondary" onClick={() => setMapSource(s)}>
                      Mapping
                    </Button>
                    <Button
                      size="sm"
                      loading={running === s.id}
                      onClick={() => handleRun(s.id)}
                      disabled={!s.is_active}
                    >
                      Jalankan
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleToggle(s)}>
                      {s.is_active ? "Nonaktifkan" : "Aktifkan"}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(s.id)}>
                      Hapus
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {addOpen && <AddSourceModal onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} />}
      {mapSource && <FieldMappingModal source={mapSource} onClose={() => setMapSource(null)} />}
    </div>
  );
}

// ─── Add Source Modal ─────────────────────────
function AddSourceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { name: "", direction: "inbound", entity_type: "products",
                     base_url: "", endpoint: "", auth_type: "apikey",
                     api_key: "", http_method: "GET", sync_interval: 3600 }
  });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: Record<string, unknown>) => {
    setLoading(true);
    try {
      await api.sync.createSource(data);
      toast.success("Sync source ditambahkan");
      onSaved();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Gagal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open title="Tambah Sync Source" onClose={onClose} width="max-w-xl">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Nama" {...register("name", { required: true })} error={errors.name && "Wajib"} />
          <Select label="Arah" {...register("direction")}>
            <option value="inbound">Masuk (API → Lokal)</option>
            <option value="outbound">Keluar (Lokal → API)</option>
          </Select>
          <Select label="Entitas" {...register("entity_type")}>
            <option value="products">Produk</option>
            <option value="categories">Kategori</option>
            <option value="customers">Pelanggan</option>
            <option value="transactions">Transaksi</option>
          </Select>
          <Select label="Metode HTTP" {...register("http_method")}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </Select>
        </div>
        <Input label="Base URL" placeholder="https://api.example.com" {...register("base_url", { required: true })} />
        <Input label="Endpoint" placeholder="/api/v1/products" {...register("endpoint", { required: true })} />
        <div className="grid grid-cols-2 gap-4">
          <Select label="Auth" {...register("auth_type")}>
            <option value="apikey">API Key</option>
            <option value="jwt">JWT</option>
            <option value="none">Tidak Ada</option>
          </Select>
          <Input label="Interval (detik)" type="number" {...register("sync_interval")} />
        </div>
        <Input label="API Key / Token" type="password" placeholder="sk_..." {...register("api_key")} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={loading}>Simpan</Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Field Mapping Modal ──────────────────────
interface MappingForm { mappings: { api_field: string; local_field: string; transform: string; default_value: string; is_required: boolean }[] }

function FieldMappingModal({ source, onClose }: { source: SyncSource; onClose: () => void }) {
  const [loading, setLoading]   = useState(false);
  const [fetching, setFetching] = useState(true);

  const { control, register, reset, handleSubmit } = useForm<MappingForm>({ defaultValues: { mappings: [] } });
  const { fields, append, remove } = useFieldArray({ control, name: "mappings" });

  useEffect(() => {
    api.sync.listMappings(source.id).then((m: FieldMapping[]) => {
      reset({ mappings: m.map((x) => ({
        api_field: x.api_field, local_field: x.local_field,
        transform: x.transform ?? "", default_value: x.default_value ?? "",
        is_required: x.is_required
      })) });
    }).finally(() => setFetching(false));
  }, []);

  const onSubmit = async (data: MappingForm) => {
    setLoading(true);
    try {
      await api.sync.saveMappings(source.id, data.mappings);
      toast.success("Mapping disimpan");
      onClose();
    } catch (e: unknown) {
      toast.error("Gagal simpan");
    } finally {
      setLoading(false);
    }
  };

  const LOCAL_FIELDS = {
    products:     ["name","sku","barcode","price","cost","stock","unit","description","ext_id"],
    categories:   ["name","description","ext_id"],
    customers:    ["name","phone","email","address","ext_id"],
    transactions: ["invoice_no","total","status","ext_id"],
  };
  const localOptions = LOCAL_FIELDS[source.entity_type as keyof typeof LOCAL_FIELDS] ?? [];

  return (
    <Modal open title={`Field Mapping — ${source.name}`} onClose={onClose} width="max-w-2xl">
      {fetching ? <Loading /> : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <p className="text-xs text-gray-500">
            Petakan field dari response API ke kolom lokal. Gunakan dot-notation untuk field bersarang (contoh: <code>data.product_name</code>).
          </p>

          {fields.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Belum ada mapping. Klik "Tambah" untuk mulai.</p>
          )}

          {fields.map((field, i) => (
            <div key={field.id} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-4">
                <Input placeholder="api.field.path" {...register(`mappings.${i}.api_field`)} />
              </div>
              <div className="col-span-1 flex items-center justify-center pt-1 text-gray-400">→</div>
              <div className="col-span-3">
                <select className="w-full border border-gray-300 rounded px-2 py-2 text-sm"
                        {...register(`mappings.${i}.local_field`)}>
                  {localOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <select className="w-full border border-gray-300 rounded px-2 py-2 text-sm"
                        {...register(`mappings.${i}.transform`)}>
                  <option value="">— transform</option>
                  <option value="trim">trim</option>
                  <option value="uppercase">UPPERCASE</option>
                  <option value="lowercase">lowercase</option>
                  <option value="to_number">→ number</option>
                  <option value="to_boolean">→ boolean</option>
                </select>
              </div>
              <div className="col-span-1 flex items-center justify-center pt-1">
                <input type="checkbox" {...register(`mappings.${i}.is_required`)}
                       title="Wajib ada" className="cursor-pointer" />
              </div>
              <div className="col-span-1 flex items-center justify-center pt-1">
                <button type="button" onClick={() => remove(i)} className="text-gray-300 hover:text-red-400 text-lg">×</button>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={() => append({ api_field: "", local_field: localOptions[0] ?? "", transform: "", default_value: "", is_required: false })}
                    className="text-xs text-gray-500 hover:text-gray-900 underline">
              + Tambah baris
            </button>
            <span className="text-xs text-gray-300">|</span>
            <span className="text-xs text-gray-400">☑ = wajib ada (error jika tidak ditemukan di API)</span>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={onClose}>Batal</Button>
            <Button type="submit" loading={loading}>Simpan Mapping</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}