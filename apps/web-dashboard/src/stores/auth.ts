import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface User {
  id: number;
  username: string;
  role: string;
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem("vms_access_token"));
  const refreshToken = ref<string | null>(localStorage.getItem("vms_refresh_token"));
  const user = ref<User | null>(null);
  const isLoading = ref<boolean>(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => Boolean(token.value));

  const setTokens = (newAccess: string, newRefresh?: string) => {
    token.value = newAccess;
    localStorage.setItem("vms_access_token", newAccess);
    if (newRefresh) {
      refreshToken.value = newRefresh;
      localStorage.setItem("vms_refresh_token", newRefresh);
    }
  };

  const clearAuth = () => {
    token.value = null;
    refreshToken.value = null;
    user.value = null;
    localStorage.removeItem("vms_access_token");
    localStorage.removeItem("vms_refresh_token");
  };

  const login = async (username: string, password: string): Promise<boolean> => {
    isLoading.value = true;
    error.value = null;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        error.value = data.message || "Authentication failed";
        return false;
      }

      const data = await res.json();
      setTokens(data.accessToken, data.refreshToken);
      user.value = data.user;
      return true;
    } catch (err: any) {
      error.value = err.message || "Network error during login";
      return false;
    } finally {
      isLoading.value = false;
    }
  };

  const refreshAccessToken = async (): Promise<boolean> => {
    if (!refreshToken.value) {
      clearAuth();
      return false;
    }
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refreshToken.value }),
      });

      if (!res.ok) {
        clearAuth();
        return false;
      }

      const data = await res.json();
      setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      clearAuth();
      return false;
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
    if (refreshToken.value) {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refreshToken.value }),
      }).catch(() => {});
    }
    clearAuth();
  };

  return {
    token,
    refreshToken,
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

