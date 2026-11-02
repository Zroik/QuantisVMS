import { useAuthStore } from "../stores/auth.js";

/**
 * Global authenticated API client (Spec §5.2, §5.4).
 * Attaches the JWT Bearer token and automatically attempts token refresh on HTTP 401.
 * If token refresh fails, it clears local credentials and safely kicks the user to /login.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const authStore = useAuthStore();
  const headers = new Headers(init?.headers || {});

  if (authStore.token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${authStore.token}`);
  }

  let res = await fetch(input, { ...init, headers });

  if (res.status === 401 && authStore.token) {
    const refreshed = await authStore.refreshAccessToken();
    if (refreshed && authStore.token) {
      // Retry with refreshed access token
      headers.set("Authorization", `Bearer ${authStore.token}`);
      res = await fetch(input, { ...init, headers });
    } else {
      // Both access & refresh token expired or invalid -> log out
      authStore.clearAuth();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
  }

  return res;
}

