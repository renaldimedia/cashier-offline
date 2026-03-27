// src/pages/Settings.tsx
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, Setting } from "../lib/tauri";
import { Button, Input, PageHeader, Loading } from "../components/ui";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [edits, setEdits]       = useState<Record<string, string>>({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    api.settings.list().then((s) => {
      setSettings(s);
      setEdits(Object.fromEntries(s.map((x) => [x.key, x.value])));
    }).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(Object.entries(edits).map(([key, value]) => api.settings.update(key, value)));
      toast.success("Pengaturan disimpan");
    } catch (e: unknown) { toast.error("Gagal menyimpan"); }
    finally { setSaving(false); }
  };

  if (loading) return <Loading />;

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Pengaturan" actions={<Button onClick={handleSave} loading={saving}>Simpan</Button>} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl space-y-4">
          {settings.map((s) => (
            <div key={s.key}>
              <label className="text-xs font-medium text-gray-600 block mb-1">{s.description || s.key}</label>
              {s.value_type === "boolean" ? (
                <select value={edits[s.key]} onChange={(e) => setEdits((p) => ({ ...p, [s.key]: e.target.value }))}
                  className="border border-gray-300 rounded px-3 py-2 text-sm w-full">
                  <option value="true">Ya</option>
                  <option value="false">Tidak</option>
                </select>
              ) : (
                <input value={edits[s.key] ?? ""} onChange={(e) => setEdits((p) => ({ ...p, [s.key]: e.target.value }))}
                  type={s.value_type === "number" ? "number" : "text"}
                  className="border border-gray-300 rounded px-3 py-2 text-sm w-full outline-none focus:border-gray-500" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}