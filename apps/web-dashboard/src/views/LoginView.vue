<template>
  <div class="min-h-screen h-full overflow-y-auto flex items-center justify-center p-4" style="background:var(--bg)">
    <div class="w-full max-w-sm">
      <article class="card" style="padding: 28px">
        <div class="flex flex-col space-y-2 text-center mb-6">
          <div class="flex flex-col items-center justify-center gap-2 mb-2">
            <img src="/quantis-symbol.png" alt="Quantis" style="width:52px; height:52px; object-fit:contain" />
            <span class="font-bold text-2xl tracking-tight" style="color:var(--text)">Quantis</span>
          </div>
          <h1 style="font-size: 18px; font-weight: 600; letter-spacing: -.02em">
            Masuk ke sistem
          </h1>
          <p class="sub">
            Otentikasi Quantis &amp; Analisis Video Forensik
          </p>
        </div>

        <form @submit.prevent="handleLogin" class="space-y-4">
          <div v-if="authStore.error" class="p-3 rounded-lg text-xs" style="background:rgba(200,69,63,0.1); border:1px solid rgba(200,69,63,0.2); color:var(--crit)">
            {{ authStore.error }}
          </div>

          <div class="space-y-1.5 text-left">
            <label class="eyebrow block">
              Nama Pengguna
            </label>
            <Input
              v-model="username"
              type="text"
              required
              autocomplete="username"
              placeholder="admin"
            />
          </div>

          <div class="space-y-1.5 text-left">
            <label class="eyebrow block">
              Kata Sandi
            </label>
            <Input
              v-model="password"
              type="password"
              required
              autocomplete="current-password"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            class="btn w-full mt-2"
            style="background:var(--accent); color:#FFFFFF; font-weight:600"
            :disabled="authStore.isLoading"
          >
            {{ authStore.isLoading ? 'Memverifikasi...' : 'Masuk' }}
          </button>
        </form>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import Input from "../components/ui/Input.vue";
import { useAuthStore } from "../stores/auth.js";

const router = useRouter();
const authStore = useAuthStore();

const username = ref("");
const password = ref("");

const handleLogin = async () => {
  const success = await authStore.login(username.value, password.value);
  if (success) {
    router.push({ name: "matrix" });
  }
};
</script>
