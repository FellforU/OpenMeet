import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useEngineStore } from "../../stores/engineStore";

const LANGUAGE_KEYS = ["auto", "zh", "en", "ja", "ko", "de", "fr", "es", "yue", "wuu"] as const;

export function LanguageSelector() {
  const { t } = useTranslation();
  const { selectedLanguage, setSelectedLanguage, engines, selectedEngine } =
    useEngineStore();

  const engine = engines.find((e) => e.name === selectedEngine);
  const supported = new Set(engine?.supported_languages || []);

  return (
    <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
      <SelectTrigger className="h-8 w-[140px] text-sm">
        <SelectValue placeholder={t("language.auto")} />
      </SelectTrigger>
      <SelectContent>
        {LANGUAGE_KEYS.map((key) => (
          <SelectItem
            key={key}
            value={key}
            disabled={supported.size > 0 && !supported.has(key) && key !== "auto"}
          >
            {t(`language.${key}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
