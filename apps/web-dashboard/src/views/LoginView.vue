<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-[#F5F5F7] dark:bg-[#000000]">
    <div class="w-full max-w-sm">
      <Card class="p-6 sm:p-8">
        <div class="flex flex-col space-y-2 text-center mb-6">
          <div class="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-[#007AFF] text-white mx-auto mb-2 shadow-xs">
            <Video class="h-6 w-6" />
          </div>
          <h1 class="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {{ $t('login.title') }}
          </h1>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">
            {{ $t('login.subtitle') }}
          </p>
        </div>

        <form @submit.prevent="handleLogin" class="space-y-4">
          <div v-if="authStore.error" class="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200/60 dark:border-red-900/60 text-xs text-[#FF3B30] font-medium">
            {{ authStore.error }}
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {{ $t('login.username') }}
            </label>
            <Input
              v-model="username"
              type="text"
              required
              autocomplete="username"
              placeholder="admin"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {{ $t('login.password') }}
            </label>
            <Input
              v-model="password"
              type="password"
              required
              autocomplete="current-password"
              placeholder="••••••••"
            />
          </div>

          <Button
            type="submit"
            class="w-full mt-2"
            :loading="authStore.isLoading"
          >
            {{ authStore.isLoading ? $t('login.loading') : $t('login.submit') }}
          </Button>
        </form>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { Video } from "lucide-vue-next";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import Input from "../components/ui/Input.vue";
import { useAuthStore } from "../stores/auth.js";

const router = useRouter();
const authStore = useAuthStore();

const username = ref<string>("admin");
const password = ref<string>("admin123");

const handleLogin = async () => {
  const success = await authStore.login(username.value, password.value);
  if (success) {
    router.push({ name: "matrix" });
  }
};
</script>

