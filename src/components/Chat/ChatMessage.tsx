import { User, Bot } from "lucide-react";
import type { ChatMessage as ChatMessageType, ChatSource } from "../../stores/chatStore";

function SourceBadge({ source }: { source: ChatSource }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
      {source.project_title}
      <span className="text-muted-foreground">· {source.source_type}</span>
    </span>
  );
}

export function ChatMessage({ message }: { message: ChatMessageType }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2 px-3 py-2 ${isUser ? "" : "bg-muted/30"}`}>
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
        {isUser ? (
          <User className="h-3.5 w-3.5" />
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {message.content}
          {!message.content && message.role === "assistant" && (
            <span className="inline-block animate-pulse text-muted-foreground">
              ...
            </span>
          )}
        </p>
        {message.sources && message.sources.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {message.sources.map((s, i) => (
              <SourceBadge key={i} source={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
