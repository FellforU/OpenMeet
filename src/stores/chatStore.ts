import { create } from "zustand";
import { sendChatMessage } from "../services/chatClient";

export interface ChatSource {
  project_id: string;
  project_title: string;
  source_type: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  timestamp: number;
}

interface ChatStore {
  messages: ChatMessage[];
  isLoading: boolean;
  isOpen: boolean;
  context: "current" | "all";

  sendMessage: (question: string, projectId?: string) => Promise<void>;
  clearMessages: () => void;
  setContext: (ctx: "current" | "all") => void;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
}

let messageCounter = 0;

function nextId(): string {
  messageCounter += 1;
  return `msg-${Date.now()}-${messageCounter}`;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isLoading: false,
  isOpen: false,
  context: "all",

  sendMessage: async (question: string, projectId?: string) => {
    const { context, isLoading } = get();
    if (isLoading) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      content: question,
      timestamp: Date.now(),
    };

    const assistantId = nextId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    };

    set({
      messages: [...get().messages, userMsg, assistantMsg],
      isLoading: true,
    });

    try {
      const pid = context === "current" ? projectId : undefined;
      for await (const event of sendChatMessage(question, context, pid)) {
        const { messages } = get();
        const last = messages[messages.length - 1];
        if (!last || last.id !== assistantId) break;

        if (event.type === "token" && event.text) {
          const updated: ChatMessage = {
            ...last,
            content: last.content + event.text,
          };
          set({ messages: [...messages.slice(0, -1), updated] });
        } else if (event.type === "sources" && event.sources) {
          const updated: ChatMessage = {
            ...last,
            sources: event.sources,
          };
          set({ messages: [...messages.slice(0, -1), updated] });
        }
      }
    } catch (error) {
      const { messages } = get();
      const last = messages[messages.length - 1];
      if (last && last.id === assistantId) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const updated: ChatMessage = {
          ...last,
          content: last.content || `Error: ${errMsg}`,
        };
        set({ messages: [...messages.slice(0, -1), updated] });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  clearMessages: () => set({ messages: [] }),
  setContext: (ctx) => set({ context: ctx }),
  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set({ isOpen: !get().isOpen }),
}));
