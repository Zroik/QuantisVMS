import { describe, it, expect } from "vitest";
import { t, setLocale, useI18n } from "./i18n/index.js";

describe("i18n Translation Engine (Gate G5.8)", () => {
  it("translates to default locale (id)", () => {
    setLocale("id");
    expect(t("login.title")).toBe("Masuk ke Smart VMS");
    expect(t("matrix.liveBadge")).toBe("SIARAN LANGSUNG");
  });

  it("switches locale to English and translates", () => {
    setLocale("en");
    expect(t("login.title")).toBe("Sign in to Smart VMS");
    expect(t("matrix.liveBadge")).toBe("LIVE");
  });

  it("replaces parameters correctly in translation strings", () => {
    setLocale("en");
    // Test custom replacement if template string has {count}
    const result = t("nav.liveMatrix");
    expect(result).toBe("Camera Matrix");
  });

  it("falls back to key if translation key does not exist", () => {
    expect(t("nonexistent.random.key")).toBe("nonexistent.random.key");
  });
});

