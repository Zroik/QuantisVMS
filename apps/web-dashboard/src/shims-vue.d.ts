import type { t } from "./i18n/index.js";

declare module "vue" {
  interface ComponentCustomProperties {
    $t: typeof t;
  }
}

export {};

