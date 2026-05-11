export function cleanForSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
