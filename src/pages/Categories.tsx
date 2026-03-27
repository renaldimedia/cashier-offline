// src/pages/Categories.tsx
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { api, Category } from "../lib/tauri";
import { Button, Input, Modal, PageHeader, EmptyState, Loading } from "../components/ui";

export default function CategoriesPage() {
  const [cats, setCats]     = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Category | null | "new">(null);

  const load = async () => {
    setLoading(true);
    const data = await api.categories.list().catch(() => []);
    setCats(data); setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Kategori" actions={<Button onClick={() => setEditing("new")}>+ Tambah</Button>} />
      <div className="flex-1 overflow-y-auto">
        {loading ? <Loading /> : cats.length === 0 ? <EmptyState message="Belum ada kategori" icon="🏷" /> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>{["Urutan","Nama","Deskripsi",""].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cats.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-400">{c.sort_order}</td>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-gray-500">{c.description || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>Edit</Button>
                      <Button size="sm" variant="danger" onClick={async () => {
                        if (!confirm("Hapus kategori ini?")) return;
                        await api.categories.delete(c.id);
                        toast.success("Dihapus"); load();
                      }}>Hapus</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing !== null && (
        <CatModal
          cat={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function CatModal({ cat, onClose, onSaved }: { cat: Category | null; onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit } = useForm({
    defaultValues: cat ?? { name: "", description: "", sort_order: 0 }
  });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: { name: string; description?: string; sort_order?: number }) => {
    setLoading(true);
    try {
        if(data?.sort_order){
            data.sort_order = Number(data.sort_order)
        }
      if (cat) { await api.categories.update(cat.id, data); }
      else      { await api.categories.create(data); }
      toast.success("Disimpan"); onSaved();
    } catch (e: unknown) { toast.error("Gagal"); }
    finally { setLoading(false); }
  };

  return (
    <Modal open title={cat ? "Edit Kategori" : "Tambah Kategori"} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <Input label="Nama *" {...register("name", { required: true })} />
        <Input label="Deskripsi" {...register("description")} />
        <Input label="Urutan" type="number" {...register("sort_order")} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={loading}>Simpan</Button>
        </div>
      </form>
    </Modal>
  );
}