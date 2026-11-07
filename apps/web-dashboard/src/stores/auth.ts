import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface User {
  id: number;
  username: string;
  role: string;
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(null);
  const user = ref<User | null>(null);
  const isLoading = ref<boolean>(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => Boolean(token.value));

  const setTokens = (newAccess: string) => {
    token.value = newAccess;
  };

  const clearAuth = () => {
    token.value = null;
    user.value = null;
  };

  const login = async (username: string, password: string): Promise<boolean> => {
    isLoading.value = true;
    error.value = null;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        error.value = data.error || data.message || "Authentication failed";
        return false;
      }

      const data = await res.json();
      setTokens(data.accessToken);
      user.value = data.user;
      return true;
    } catch (err: any) {
      error.value = err.message || "Network error during login";
      return false;
    } finally {
      isLoading.value = false;
    }
  };

  let refreshPromise: Promise<boolean> | null = null;

  const refreshAccessToken = async (): Promise<boolean> => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
          clearAuth();
          return false;
        }

        const data = await res.json();
        setTokens(data.accessToken);
        return true;
      } catch {
        clearAuth();
        return false;
      }
    })();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  };

  const fetchCurrentUser = async (): Promise<boolean> => {
    if (!token.value) return false;
    try {
      let res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token.value}` },
      });

      if (res.status === 401) {
        const refreshed = await refreshAccessToken();
        if (!refreshed) return false;
        res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token.value}` },
        });
      }

      if (!res.ok) return false;
      const data = await res.json();
      user.value = data.user;
      return true;
    } catch {
      return false;
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    }).catch(() => {});
    clearAuth();
  };

  return {
    token,
    user,
    isLoading,
    error,
    isAuthenticated,
    login,
    logout,
    clearAuth,
    fetchCurrentUser,
    refreshAccessToken,
  };
});

