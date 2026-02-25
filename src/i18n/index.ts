import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import zhCommon from "./locales/zh/common.json";
import zhWorkspace from "./locales/zh/workspace.json";
import zhSettings from "./locales/zh/settings.json";
import zhGuide from "./locales/zh/guide.json";
import enCommon from "./locales/en/common.json";
import enWorkspace from "./locales/en/workspace.json";
import enSettings from "./locales/en/settings.json";
import enGuide from "./locales/en/guide.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: {
        common: zhCommon,
        workspace: zhWorkspace,
        settings: zhSettings,
        guide: zhGuide,
      },
      en: {
        common: enCommon,
        workspace: enWorkspace,
        settings: enSettings,
        guide: enGuide,
      },
    },
    fallbackLng: "zh",
    defaultNS: "common",
    ns: ["common", "workspace", "settings", "guide"],
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "openmeet_language",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
