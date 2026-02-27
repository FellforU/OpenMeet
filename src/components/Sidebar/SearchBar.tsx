import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Search, Clock, Loader2 } from "lucide-react";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { tauriFetch } from "../../services/httpProxy";

const ASR_BASE_URL = "http://127.0.0.1:18090";

interface SearchResult {
  job_id: string;
  segment_index: number;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
}

export function SearchBar({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async (value: string) => {
    if (!value.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);

    try {
      const resp = await tauriFetch(
        `${ASR_BASE_URL}/search?q=${encodeURIComponent(value)}`,
        { method: "GET" },
      );
      if (resp.status >= 200 && resp.status < 300) {
        const data = JSON.parse(resp.body);
        setResults(data.results);
      } else {
        setResults([]);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className={compact ? "" : "px-3 py-2"}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-7 text-sm"
          placeholder={t("sidebar.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch(query);
          }}
        />
        {loading && (
          <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {searched && results.length === 0 && !loading && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {t("sidebar.noResults")}
        </p>
      )}
      {results.length > 0 && (
        <div className="mt-2 max-h-[300px] space-y-1 overflow-y-auto">
          {results.map((item, i) => (
            <div key={i} className="rounded-md p-1.5 hover:bg-accent">
              <div className="mb-0.5 flex gap-1">
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Clock className="h-2.5 w-2.5" />
                  {formatTime(item.start)}
                </Badge>
                {item.speaker && (
                  <Badge className="text-[10px]">{item.speaker}</Badge>
                )}
              </div>
              <p className="truncate text-xs">{item.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
