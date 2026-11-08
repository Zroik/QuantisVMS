import { ref, type App } from "vue";
import idCatalog from "../locales/id.json";
import enCatalog from "../locales/en.json";

export type SupportedLocale = "id" | "en";

const catalogs: Record<SupportedLocale, Record<string, string>> = {
  id: idCatalog,
  en: enCatalog,
};

const savedLocale = (localStorage.getItem("vms_lang") as SupportedLocale) || "id";
const currentLocale = ref<SupportedLocale>(savedLocale in catalogs ? savedLocale : "id");

// Apply the persisted locale's lang attribute on first boot so screen readers
// announce the page correctly before any toggle happens (FE-27).
if (typeof document !== "undefined") {
  document.documentElement.lang = currentLocale.value;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const catalog = catalogs[currentLocale.value] || catalogs.id;
  let text = catalog[key] || catalogs.en[key] || key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`{${k}}`, "g"), String(v));
    }
  }

  return text;
}

export function setLocale(lang: SupportedLocale): void {
  if (lang in catalogs) {
    currentLocale.value = lang;
    localStorage.setItem("vms_lang", lang);
    document.documentElement.lang = lang;
  }
}

export function useI18n() {
  return {
    locale: currentLocale,
    t,
    setLocale,
  };
}

export const i18nPlugin = {
  install(app: App) {
    app.config.globalProperties.$t = t;
    app.provide("i18n", {
      locale: currentLocale,
      t,
      setLocale,
    });
  },
};

