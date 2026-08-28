import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, Clock, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { useProjectStore } from "../../stores/projectStore";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

interface SegmentSearchResult {
  projectId: string;
  projectTitle: string;
  startTime: number;
  text: string;
  speaker: string | null;
}

export function SearchBar({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SegmentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 输入即搜（防抖 300ms），搜索的是 SQLite 里所有会议的转录内容
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await invoke<SegmentSearchResult[]>("db_search_segments", {
          query: q,
          limit: 50,
        });
        setResults(found);
        setOpen(true);
      } catch {
        setResults([]);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleJump = (item: SegmentSearchResult) => {
    setOpen(false);
    useProjectStore.getState().setActiveProject(item.projectId);
    // 等目标会议的 segments 加载完成后再定位高亮
    setTimeout(() => {
      useTranscriptionStore.getState().seekTo(item.startTime);
    }, 500);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className={compact ? "" : "px-3 py-2"}>
      {/* 结果用绝对定位浮层展示，不撑开所在行的布局 */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-7 text-sm"
          placeholder={t("sidebar.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0 || query.trim()) setOpen(true);
          }}
          onBlur={() => {
            // 延迟关闭，让结果项的 onMouseDown 先触发
            setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              setOpen(false);
            }
          }}
        />
        {loading && (
          <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}

        {open && !loading && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[320px] overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
            {results.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {t("sidebar.noResults")}
              </p>
            ) : (
              results.map((item, i) => (
                <button
                  key={i}
                  className="w-full rounded-md p-1.5 text-left hover:bg-accent"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleJump(item);
                  }}
                >
                  <div className="mb-0.5 flex items-center gap-1">
                    <span className="max-w-[45%] truncate text-[10px] font-medium text-primary">
                      {item.projectTitle}
                    </span>
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Clock className="h-2.5 w-2.5" />
                      {formatTime(item.startTime)}
                    </Badge>
                    {item.speaker && (
                      <Badge className="max-w-[35%] truncate text-[10px]">{item.speaker}</Badge>
                    )}
                  </div>
                  <p className="truncate text-xs">{item.text}</p>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
