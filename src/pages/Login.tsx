// src/pages/Login.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";

import { api } from "../lib/tauri";
import { useAuthStore } from "../store/authStore";
import { Button, Input } from "../components/ui";

interface LoginForm { username: string; password: string }

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const { setSession } = useAuthStore();
  const navigate = useNavigate();

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>();

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    try {
      const result = await api.auth.login(data.username, data.password);
      setSession(result.session);
      toast.success(`Selamat datang, ${result.session.full_name}`);
      navigate("/");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Login gagal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-xl border border-gray-200 p-8">
          <div className="mb-7">
            <h1 className="font-semibold text-xl text-gray-900">POS App</h1>
            <p className="text-sm text-gray-400 mt-1">Masuk untuk melanjutkan</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <Input
              label="Username"
              placeholder="superadmin"
              autoFocus
              error={errors.username?.message}
              {...register("username", { required: "Username wajib diisi" })}
            />
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              error={errors.password?.message}
              {...register("password", { required: "Password wajib diisi" })}
            />
            <Button type="submit" loading={loading} className="mt-2 w-full" size="lg">
              Masuk
            </Button>
          </form>
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">Offline First POS</p>
      </div>
    </div>
  );
}