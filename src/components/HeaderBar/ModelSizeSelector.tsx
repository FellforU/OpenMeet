import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useEngineStore } from "../../stores/engineStore";

export function ModelSizeSelector() {
  const { t } = useTranslation();
  const { engines, selectedEngine, selectedModelSize, setSelectedModelSize } =
    useEngineStore();

  const engine = engines.find((e) => e.name === selectedEngine);
  const sizes = engine?.model_sizes || [];

  return (
    <Select
      value={selectedModelSize}
      onValueChange={setSelectedModelSize}
      disabled={sizes.length === 0}
    >
      <SelectTrigger className="h-8 w-[160px] text-sm">
        <SelectValue placeholder={t("model.selectSize")} />
      </SelectTrigger>
      <SelectContent>
        {sizes.map((size) => (
          <SelectItem key={size} value={size}>
            {size}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
