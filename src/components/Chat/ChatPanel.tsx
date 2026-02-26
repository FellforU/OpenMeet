import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, Send, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { useChatStore } from "../../stores/chatStore";
import { useProjectStore } from "../../stores/projectStore";
import { ChatMessage } from "./ChatMessage";

export function ChatPanel() {
  const { t } = useTranslation("workspace");
  const {
    messages,
    isLoading,
    context,
    sendMessage,
    clearMessages,
    setContext,
    setOpen,
  } = useChatStore();
  const { activeProjectId } = useProjectStore();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    sendMessage(trimmed, activeProjectId || undefined);
  }, [input, isLoading, sendMessage, activeProjectId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="flex h-[500px] w-[400px] flex-col rounded-l-lg border bg-background shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t("chat.title")}</span>
          <div className="flex rounded-md border">
            <button
              className={`px-2 py-0.5 text-xs ${
                context === "current"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setContext("current")}
            >
              {t("chat.currentProject")}
            </button>
            <button
              className={`px-2 py-0.5 text-xs ${
                context === "all"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setContext("all")}
            >
              {t("chat.allKnowledge")}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={clearMessages}
            title={t("chat.clear")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setOpen(false)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {t("chat.placeholder")}
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-2">
        <div className="flex gap-2">
          <textarea
            className="flex-1 resize-none rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
            rows={1}
            placeholder={t("chat.inputPlaceholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <Button
            size="sm"
            className="h-8 w-8 p-0"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
