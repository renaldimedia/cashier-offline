// src/pages/Users.tsx
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { api, User } from "../lib/tauri";
import { Button, Input, Select, Modal, Badge, PageHeader, EmptyState, Loading } from "../components/ui";

export default function UsersPage() {
  const [users, setUsers]   = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await api.users.list().catch(() => []);
    setUsers(data); setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleToggle = async (u: User) => {
    await api.users.update({ id: u.id, is_active: !u.is_active });
    toast.success(u.is_active ? "User dinonaktifkan" : "User diaktifkan");
    load();
  };

  const roleColors: Record<string, "blue" | "green" | "gray"> = {
    superadmin: "blue", manager: "green", cashier: "gray"
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Pengguna" subtitle="Maks. 1 user aktif per role"
        actions={<Button onClick={() => setAddOpen(true)}>+ Tambah User</Button>} />
      <div className="flex-1 overflow-y-auto">
        {loading ? <Loading /> : users.length === 0 ? <EmptyState message="Belum ada pengguna" /> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>{["Username","Nama","Role","Status",""].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm">{u.username}</td>
                  <td className="px-4 py-3">{u.full_name}</td>
                  <td className="px-4 py-3"><Badge label={u.role} color={roleColors[u.role] ?? "gray"} /></td>
                  <td className="px-4 py-3"><Badge label={u.is_active ? "Aktif" : "Nonaktif"} color={u.is_active ? "green" : "gray"} /></td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant={u.is_active ? "danger" : "secondary"} onClick={() => handleToggle(u)}>
                      {u.is_active ? "Nonaktifkan" : "Aktifkan"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {addOpen && <AddUserModal onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} />}
    </div>
  );
}

function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { username: "", password: "", role: "cashier", full_name: "" }
  });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: { username: string; password: string; role: string; full_name: string }) => {
    setLoading(true);
    try {
      await api.users.create(data);
      toast.success("User ditambahkan");
      onSaved();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Gagal"); }
    finally { setLoading(false); }
  };

  return (
    <Modal open title="Tambah Pengguna" onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <Input label="Nama Lengkap *" {...register("full_name", { required: true })} error={errors.full_name && "Wajib"} />
        <Input label="Username *" {...register("username", { required: true })} error={errors.username && "Wajib"} />
        <Input label="Password *" type="password" {...register("password", { required: true, minLength: 6 })}
          error={errors.password && "Minimal 6 karakter"} />
        <Select label="Role" {...register("role")}>
          <option value="cashier">Kasir</option>
          <option value="manager">Manager</option>
          <option value="superadmin">Super Admin</option>
        </Select>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={loading}>Simpan</Button>
        </div>
      </form>
    </Modal>
  );
}