import { useState } from "react";
import { Tag, Input, Popover } from "antd";

const SPEAKER_COLORS = [
  "blue",
  "purple",
  "cyan",
  "green",
  "orange",
  "magenta",
  "gold",
  "lime",
];

interface SpeakerBadgeProps {
  speaker: string;
  onRename?: (oldName: string, newName: string) => void;
}

export function SpeakerBadge({ speaker, onRename }: SpeakerBadgeProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(speaker);

  // Deterministic color based on speaker name
  const colorIndex =
    speaker.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) %
    SPEAKER_COLORS.length;
  const color = SPEAKER_COLORS[colorIndex];

  const handleConfirm = () => {
    setEditing(false);
    if (name.trim() && name !== speaker && onRename) {
      onRename(speaker, name.trim());
    }
  };

  const content = (
    <Input
      size="small"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onPressEnter={handleConfirm}
      onBlur={handleConfirm}
      style={{ width: 120 }}
      autoFocus
    />
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={editing}
      onOpenChange={setEditing}
    >
      <Tag
        color={color}
        style={{ flexShrink: 0, fontSize: 11, cursor: "pointer" }}
      >
        {speaker}
      </Tag>
    </Popover>
  );
}
