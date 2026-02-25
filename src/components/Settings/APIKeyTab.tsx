import { useTranslation } from "react-i18next";
import { Shield, Cloud, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "../ui/alert";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

interface APIProvider {
  key: string;
  name: string;
  description: string;
  placeholder: string;
}

const API_PROVIDERS: APIProvider[] = [
  {
    key: "openai",
    name: "OpenAI Whisper",
    description: "Cloud transcription via OpenAI Whisper API. Supports 50+ languages.",
    placeholder: "sk-proj-...",
  },
  {
    key: "alibaba",
    name: "Alibaba Cloud ASR",
    description: "Chinese-optimized cloud ASR via DashScope Paraformer API.",
    placeholder: "LTAI5t...",
  },
];

function PasswordInput({ placeholder }: { placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        placeholder={placeholder}
        className="pr-10"
      />
      <Button
        variant="ghost"
        size="sm"
        className="absolute right-0 top-0 h-full px-3"
        onClick={() => setShow(!show)}
        type="button"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export function APIKeyTab() {
  const { t } = useTranslation("settings");

  return (
    <div className="space-y-4 py-2">
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          {t("apiKeys.securityNote")}
        </AlertDescription>
      </Alert>

      {API_PROVIDERS.map((provider) => (
        <div
          key={provider.key}
          className="space-y-3 rounded-lg border border-border p-4"
        >
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Cloud className="h-3 w-3" />
              {provider.name}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {provider.description}
          </p>

          {provider.key === "openai" ? (
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("apiKeys.openai")}</label>
              <PasswordInput placeholder={provider.placeholder} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t("apiKeys.alibabaId")}</label>
                <Input placeholder="LTAI5t..." />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{t("apiKeys.alibabaSecret")}</label>
                <PasswordInput placeholder="..." />
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">{t("apiKeys.autoDegradation")}</label>
          <p className="text-xs text-muted-foreground">{t("apiKeys.autoDegradationDesc")}</p>
        </div>
        <Switch defaultChecked />
      </div>
    </div>
  );
}
