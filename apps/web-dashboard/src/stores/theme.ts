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
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("vms_theme", mode);
    }
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.dataset.theme = mode;
      document.documentElement.style.colorScheme = mode;
      if (mode === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  };

  // Immediately apply initial theme to ensure colorScheme and dataset are synchronized
  applyTheme(initialTheme);

  const toggleTheme = (event?: MouseEvent | { clientX: number; clientY: number }) => {
    const nextTheme: ThemeMode = theme.value === "dark" ? "light" : "dark";
    const isDarkToLight = theme.value === "dark";

    // Fallback if View Transitions API is unavailable or user requested reduced motion
    const hasMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function";
    const isReducedMotion = hasMatchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const isAppearanceTransition =
      typeof document !== "undefined" &&
      "startViewTransition" in document &&
      !isReducedMotion;

    if (!isAppearanceTransition) {
      applyTheme(nextTheme);
      return;
    }

    // Cari elemen tombol switch tema untuk menentukan titik pusat (center) tombol sebagai koordinat acuan animasi
    let btn: HTMLElement | null = null;
    if (event && "currentTarget" in event && event.currentTarget instanceof HTMLElement) {
      btn = event.currentTarget;
    } else if (event && "target" in event && event.target instanceof HTMLElement) {
      btn = event.target.closest<HTMLElement>("button#theme, #theme, button.tb, button");
    }

    if (!btn && typeof document !== "undefined") {
      btn = document.getElementById("theme") || document.querySelector<HTMLElement>("button.tb, #theme");
    }

    // Titik koordinat acuan animasi sirkular: FIXED pada posisi paling tengah tombol, bukan posisi kursor
    let x: number;
    let y: number;

    if (btn && typeof btn.getBoundingClientRect === "function") {
      const rect = btn.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    } else if (event && typeof (event as any).clientX === "number" && typeof (event as any).clientY === "number" && ((event as any).clientX !== 0 || (event as any).clientY !== 0)) {
      x = (event as any).clientX;
      y = (event as any).clientY;
    } else {
      x = typeof window !== "undefined" ? window.innerWidth / 2 : 0;
      y = typeof window !== "undefined" ? window.innerHeight / 2 : 0;
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
