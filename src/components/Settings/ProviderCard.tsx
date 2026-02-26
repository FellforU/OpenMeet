import { useTranslation } from "react-i18next";
import { Server, Cloud, Check } from "lucide-react";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import { Button } from "../ui/button";

interface ProviderCardProps {
  logoSrc: string;
  brandColor: string;
  name: string;
  description: string;
  type: "local" | "cloud";
  supportedTypes?: string[];
  isConfigured: boolean;
  isEnabled?: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
  onClick: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  LLM: "border-blue-300 text-blue-600",
  EMBEDDING: "border-purple-300 text-purple-600",
  RERANK: "border-amber-300 text-amber-600",
};

export function ProviderCard({
  logoSrc,
  brandColor,
  name,
  description,
  type,
  supportedTypes,
  isConfigured,
  isEnabled,
  onToggleEnabled,
  onClick,
}: ProviderCardProps) {
  const { t } = useTranslation("settings");

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
      onClick={onClick}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${brandColor}10` }}
      >
        <img src={logoSrc} alt={name} className="h-6 w-6" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{name}</span>
          <Badge
            variant={type === "local" ? "secondary" : "outline"}
            className="gap-1 text-[10px]"
          >
            {type === "local" ? (
              <Server className="h-2.5 w-2.5" />
            ) : (
              <Cloud className="h-2.5 w-2.5" />
            )}
            {t(`llm.${type}`)}
          </Badge>
          {isConfigured && (
            <Badge variant="outline" className="gap-1 border-green-300 text-[10px] text-green-600">
              <Check className="h-2.5 w-2.5" />
              {t("llm.configured")}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <p className="truncate text-xs text-muted-foreground">
            {description}
          </p>
          {supportedTypes && supportedTypes.length > 0 && (
            <div className="flex shrink-0 gap-0.5">
              {supportedTypes.map((st) => (
                <Badge
                  key={st}
                  variant="outline"
                  className={`text-[9px] px-1 py-0 ${TYPE_COLORS[st] || ""}`}
                >
                  {st}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {isConfigured && onToggleEnabled ? (
        <Switch
          checked={isEnabled}
          onCheckedChange={(val) => {
            onToggleEnabled(val);
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Toggle ${name}`}
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {t("llm.configureBtn")}
        </Button>
      )}
    </div>
  );
}
