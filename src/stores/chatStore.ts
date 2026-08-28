import { create } from "zustand";
import { fetchChatContext } from "../services/chatClient";
import { generateChatStream } from "../services/llmClient";
import type { ChatSource as ServiceChatSource } from "../services/chatClient";

export type ChatSource = ServiceChatSource;

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

const SYSTEM_PROMPT = `你是 OpenMeet 的 AI 助手，负责基于会议数据回答用户问题。

请遵循以下规则：
1. 只基于提供的上下文信息回答，不要编造内容
2. 如果上下文中没有相关信息，明确告知用户
3. 引用来源时标注会议名称和时间
4. 回答简洁清晰，使用中文
5. 对于统计类问题，给出准确的数字`;

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
      // Step 1: Fetch retrieval context from ASR service
      const pid = context === "current" ? projectId : undefined;
      const ctxResult = await fetchChatContext(question, context, pid);

      // Step 2: Build prompt with context
      const userPrompt = `上下文信息：
${ctxResult.context_text}

用户问题：${question}

请基于上下文信息回答问题。`;

      // Step 3: Stream LLM response using user-configured provider
      for await (const token of generateChatStream(SYSTEM_PROMPT, userPrompt)) {
        const { messages } = get();
        const last = messages[messages.length - 1];
        if (!last || last.id !== assistantId) break;

        const updated: ChatMessage = {
          ...last,
          content: last.content + token,
        };
        set({ messages: [...messages.slice(0, -1), updated] });
      }

      // Step 4: Attach sources
      if (ctxResult.sources.length > 0) {
        const { messages } = get();
        const last = messages[messages.length - 1];
        if (last && last.id === assistantId) {
          const updated: ChatMessage = {
            ...last,
            sources: ctxResult.sources,
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
