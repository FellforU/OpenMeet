import { useRef, useCallback } from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chatStore";
import { ChatPanel } from "./ChatPanel";

export function ChatButton() {
  const { t } = useTranslation("workspace");
  const { isOpen, setOpen } = useChatStore();
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearTimer();
    setOpen(true);
  }, [clearTimer, setOpen]);

  const handleMouseLeave = useCallback(() => {
    clearTimer();
    leaveTimer.current = setTimeout(() => setOpen(false), 300);
  }, [clearTimer, setOpen]);

  return (
    <div
      className="fixed right-0 top-1/2 z-50 -translate-y-1/2"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {isOpen ? (
        <ChatPanel />
      ) : (
        <div className="flex h-24 w-6 cursor-pointer items-center justify-center rounded-l-md bg-primary/90 text-primary-foreground shadow-lg transition-all hover:w-8 hover:bg-primary">
          <div className="flex flex-col items-center gap-1">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="text-[9px] font-medium leading-tight [writing-mode:vertical-rl]">
              {t("chat.title")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
