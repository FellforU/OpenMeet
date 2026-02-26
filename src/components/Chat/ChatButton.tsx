import { Sparkles } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { ChatPanel } from "./ChatPanel";

export function ChatButton() {
  const { isOpen, toggleOpen } = useChatStore();

  return (
    <>
      {isOpen && <ChatPanel />}
      <button
        onClick={toggleOpen}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
        title="AI Chat"
      >
        <Sparkles className="h-5 w-5" />
      </button>
    </>
  );
}
