/**
 * 说话人配色：按名字哈希取色，转写页徽章和音色库共用同一套，
 * 保证同一个人在两处颜色一致。
 */

export const SPEAKER_BADGE_COLORS = [
  "bg-blue-100 text-blue-800",
  "bg-purple-100 text-purple-800",
  "bg-cyan-100 text-cyan-800",
  "bg-green-100 text-green-800",
  "bg-orange-100 text-orange-800",
  "bg-pink-100 text-pink-800",
  "bg-yellow-100 text-yellow-800",
  "bg-lime-100 text-lime-800",
];

export const SPEAKER_DOT_COLORS = [
  "bg-blue-400",
  "bg-purple-400",
  "bg-cyan-400",
  "bg-green-400",
  "bg-orange-400",
  "bg-pink-400",
  "bg-yellow-400",
  "bg-lime-400",
];

export function speakerColorIndex(name: string): number {
  return (
    name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) %
    SPEAKER_BADGE_COLORS.length
  );
}
