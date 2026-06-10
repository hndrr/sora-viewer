// Prompt 内の @avatar を抽出（App のフィルタと縦フィードのオーバーレイで共用）
export function extractAvatars(prompt: string): string[] {
  return [...new Set((prompt.match(/@[\w_.]+/g) ?? []).map((m) => m.toLowerCase()))];
}
