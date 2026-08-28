import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";
import { useVoiceprintStore } from "../../stores/voiceprintStore";
import { SPEAKER_BADGE_COLORS, speakerColorIndex } from "@/lib/speakerColors";

interface SpeakerBadgeProps {
  speaker: string;
  voiceprintId?: string | null;
  onRename?: (oldName: string, newName: string) => void;
  onAssignVoiceprint?: (voiceprintId: string, name: string) => void;
}

export function SpeakerBadge({
  speaker,
  voiceprintId,
  onRename,
  onAssignVoiceprint,
}: SpeakerBadgeProps) {
  const { t } = useTranslation("workspace");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const voiceprints = useVoiceprintStore((s) => s.voiceprints);
  const loadVoiceprints = useVoiceprintStore((s) => s.loadVoiceprints);

  const colorIndex = speakerColorIndex(speaker);

  const filtered = useMemo(() => {
    if (!search.trim()) return voiceprints;
    const q = search.toLowerCase();
    return voiceprints.filter(
      (vp) =>
        vp.name.toLowerCase().includes(q) ||
        vp.nickname.toLowerCase().includes(q) ||
        vp.department.toLowerCase().includes(q),
    );
  }, [voiceprints, search]);

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (v) {
      setSearch("");
      loadVoiceprints();
    }
  };

  const handleSelectVoiceprint = (vpId: string, vpName: string) => {
    setOpen(false);
    if (onAssignVoiceprint) {
      onAssignVoiceprint(vpId, vpName);
    } else if (onRename && vpName !== speaker) {
      onRename(speaker, vpName);
    }
  };

  const handleInputNewName = () => {
    if (!search.trim() || search.trim() === speaker) return;
    setOpen(false);
    if (onRename) {
      onRename(speaker, search.trim());
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <span
          className={cn(
            "shrink-0 cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-medium",
            SPEAKER_BADGE_COLORS[colorIndex],
            voiceprintId && "ring-1 ring-primary/30",
          )}
        >
          {speaker}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2" align="start">
        <Input
          className="mb-2 h-7 text-sm"
          placeholder={t("voiceprint.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleInputNewName();
          }}
          autoFocus
        />
        <div className="max-h-40 overflow-y-auto">
          {filtered.map((vp) => (
            <button
              key={vp.id}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted",
                vp.id === voiceprintId && "bg-primary/10 font-medium",
              )}
              onClick={() => handleSelectVoiceprint(vp.id, vp.name)}
            >
              <span className="truncate">{vp.name}</span>
              {vp.department && (
                <span className="ml-auto truncate text-[10px] text-muted-foreground">
                  {vp.department}
                </span>
              )}
            </button>
          ))}
          {filtered.length === 0 && voiceprints.length > 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {t("voiceprint.noMatch")}
            </p>
          )}
        </div>
        {search.trim() && search.trim() !== speaker && (
          <button
            className="mt-1 flex w-full items-center gap-1 rounded border-t px-2 py-1.5 text-xs text-primary hover:bg-muted"
            onClick={handleInputNewName}
          >
            {t("voiceprint.renameAs", { name: search.trim() })}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
