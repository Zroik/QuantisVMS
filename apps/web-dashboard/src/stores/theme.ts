import { defineStore } from "pinia";
import { ref } from "vue";

export type ThemeMode = "light" | "dark";

export const useThemeStore = defineStore("theme", () => {
  const storedTheme = typeof localStorage !== "undefined" ? (localStorage.getItem("vms_theme") as ThemeMode | null) : null;
  const hasMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const initialTheme: ThemeMode = storedTheme || (hasMatchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  const theme = ref<ThemeMode>(initialTheme);

  const applyTheme = (mode: ThemeMode) => {
    theme.value = mode;
    localStorage.setItem("vms_theme", mode);
    if (mode === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const toggleTheme = () => {
    applyTheme(theme.value === "dark" ? "light" : "dark");
  };

  // Initial application
  applyTheme(initialTheme);

  return {
    theme,
    toggleTheme,
    applyTheme,
  };
});
