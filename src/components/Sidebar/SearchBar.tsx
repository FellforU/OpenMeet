import { useState, useCallback } from "react";
import { Input, List, Typography, Empty, Tag } from "antd";
import { SearchOutlined, ClockCircleOutlined } from "@ant-design/icons";

const { Text } = Typography;
const { Search } = Input;

const ASR_BASE_URL = "http://127.0.0.1:18090";

interface SearchResult {
  job_id: string;
  segment_index: number;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
}

export function SearchBar() {
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
      const resp = await fetch(
        `${ASR_BASE_URL}/search?q=${encodeURIComponent(value)}`,
      );
      if (resp.ok) {
        const data = await resp.json();
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
    <div style={{ padding: "8px 12px" }}>
      <Search
        placeholder="Search transcripts..."
        prefix={<SearchOutlined />}
        onSearch={handleSearch}
        loading={loading}
        allowClear
        size="small"
      />
      {searched && results.length === 0 && !loading && (
        <Empty
          description="No results"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ marginTop: 12 }}
        />
      )}
      {results.length > 0 && (
        <List
          size="small"
          style={{ marginTop: 8, maxHeight: 300, overflowY: "auto" }}
          dataSource={results}
          renderItem={(item) => (
            <List.Item style={{ padding: "4px 0" }}>
              <div style={{ width: "100%" }}>
                <div style={{ display: "flex", gap: 4, marginBottom: 2 }}>
                  <Tag
                    icon={<ClockCircleOutlined />}
                    style={{ fontSize: 10 }}
                  >
                    {formatTime(item.start)}
                  </Tag>
                  {item.speaker && (
                    <Tag color="blue" style={{ fontSize: 10 }}>
                      {item.speaker}
                    </Tag>
                  )}
                </div>
                <Text
                  ellipsis={{ tooltip: item.text }}
                  style={{ fontSize: 12 }}
                >
                  {item.text}
                </Text>
              </div>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
