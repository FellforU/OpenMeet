import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";

const SPEAKER_COLORS = [
  "bg-blue-100 text-blue-800",
  "bg-purple-100 text-purple-800",
  "bg-cyan-100 text-cyan-800",
  "bg-green-100 text-green-800",
  "bg-orange-100 text-orange-800",
  "bg-pink-100 text-pink-800",
  "bg-yellow-100 text-yellow-800",
  "bg-lime-100 text-lime-800",
];

interface SpeakerBadgeProps {
  speaker: string;
  onRename?: (oldName: string, newName: string) => void;
}

export function SpeakerBadge({ speaker, onRename }: SpeakerBadgeProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(speaker);

  const colorIndex =
    speaker.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) %
    SPEAKER_COLORS.length;

  const handleConfirm = () => {
    setEditing(false);
    if (name.trim() && name !== speaker && onRename) {
      onRename(speaker, name.trim());
    }
  };

  return (
    <Popover open={editing} onOpenChange={setEditing}>
      <PopoverTrigger asChild>
        <span
          className={cn(
            "shrink-0 cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-medium",
            SPEAKER_COLORS[colorIndex]
          )}
        >
          {speaker}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-36 p-2" align="start">
        <Input
          className="h-7 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
          }}
          onBlur={handleConfirm}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
