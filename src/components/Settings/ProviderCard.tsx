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
  isConfigured: boolean;
  isEnabled?: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
  onClick: () => void;
}

export function ProviderCard({
  logoSrc,
  brandColor,
  name,
  description,
  type,
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
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {description}
        </p>
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
