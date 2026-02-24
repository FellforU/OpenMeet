import { Select } from "antd";
import { useEngineStore } from "../../stores/engineStore";

const LANGUAGES = [
  { value: "auto", label: "Auto Detect" },
  { value: "zh", label: "Chinese" },
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "yue", label: "Cantonese" },
  { value: "wuu", label: "Wu (Shanghai)" },
];

export function LanguageSelector() {
  const { selectedLanguage, setSelectedLanguage, engines, selectedEngine } =
    useEngineStore();

  const engine = engines.find((e) => e.name === selectedEngine);
  const supported = new Set(engine?.supported_languages || []);

  const options = LANGUAGES.map((lang) => ({
    ...lang,
    disabled: supported.size > 0 && !supported.has(lang.value) && lang.value !== "auto",
  }));

  return (
    <Select
      value={selectedLanguage}
      onChange={setSelectedLanguage}
      options={options}
      style={{ width: 140 }}
      placeholder="Language"
    />
  );
}
