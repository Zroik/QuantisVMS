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
    document.documentElement.dataset.theme = mode;
    if (mode === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const toggleTheme = (event?: MouseEvent | { clientX: number; clientY: number }) => {
    const nextTheme: ThemeMode = theme.value === "dark" ? "light" : "dark";
    const isDarkToLight = theme.value === "dark";

    // Fallback if View Transitions API is unavailable or user requested reduced motion
    const isAppearanceTransition =
      typeof document !== "undefined" &&
      "startViewTransition" in document &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!isAppearanceTransition) {
      applyTheme(nextTheme);
      return;
    }

    // Determine circular ripple origin (from click coordinates or theme button center)
    let x: number;
    let y: number;

    if (event && typeof event.clientX === "number" && (event.clientX !== 0 || event.clientY !== 0)) {
      x = event.clientX;
      y = event.clientY;
    } else {
      const btn = (event && "currentTarget" in event ? (event.currentTarget as HTMLElement) : null) || document.getElementById("theme");
      if (btn && typeof btn.getBoundingClientRect === "function") {
        const rect = btn.getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
      } else {
        x = window.innerWidth / 2;
        y = window.innerHeight / 2;
      }
    }

    // Compute maximum distance to the furthest viewport corner
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    // Relaxed dynamic duration: calibrated comfortably based on travel distance
    const duration = Math.min(780, Math.max(550, Math.round(endRadius * 0.44)));

    // Set transition direction attribute for CSS layering
    const transitionDirection = isDarkToLight ? "dark-to-light" : "light-to-dark";
    document.documentElement.dataset.themeTransition = transitionDirection;

    const transition = (document as any).startViewTransition(() => {
      applyTheme(nextTheme);
    });

    transition.ready.then(() => {
      if (isDarkToLight) {
        // Hitam ke Putih: Lingkaran hitam mengecil ke koordinat tombol switch mode
        const anim = document.documentElement.animate(
          {
            clipPath: [
              `circle(${endRadius}px at ${x}px ${y}px)`,
              `circle(0px at ${x}px ${y}px)`,
            ],
          },
          {
            duration,
            easing: "cubic-bezier(0.25, 1, 0.4, 1)",
            pseudoElement: "::view-transition-old(root)",
          }
        );
        anim.onfinish = () => {
          delete document.documentElement.dataset.themeTransition;
        };
      } else {
        // Putih ke Hitam: Lingkaran hitam membesar dari koordinat tombol switch mode
        const anim = document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration,
            easing: "cubic-bezier(0.25, 1, 0.4, 1)",
            pseudoElement: "::view-transition-new(root)",
          }
        );
        anim.onfinish = () => {
          delete document.documentElement.dataset.themeTransition;
        };
      }
    });

    transition.finished.finally(() => {
      delete document.documentElement.dataset.themeTransition;
    });
  };

  // Initial application
  applyTheme(initialTheme);

  return {
    theme,
    toggleTheme,
    applyTheme,
  };
});
