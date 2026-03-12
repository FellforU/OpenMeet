const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * Generate a default meeting name based on current date/time.
 * Format: "会议 MM-DD 周X HH:mm"
 */
export function generateDefaultMeetingName(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const weekday = WEEKDAYS_ZH[now.getDay()];
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `会议 ${mm}-${dd} 周${weekday} ${hh}:${min}`;
}
