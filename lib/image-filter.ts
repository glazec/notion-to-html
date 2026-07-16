const emojiPattern = /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?\p{Emoji_Modifier}?)*)/gu;

export function stripEmoji(value: string): string {
  return value.replace(emojiPattern, "");
}

export function isDecorativeEmojiImage(image: {
  alt?: string;
  sourceUrl?: string;
}): boolean {
  if (isNotionEmojiUrl(image.sourceUrl ?? "")) return true;

  const alt = image.alt?.trim() ?? "";
  const withoutEmoji = stripEmoji(alt);
  if (withoutEmoji === alt) return false;

  return withoutEmoji
    .replace(/\bpage icon\b/gi, "")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .length === 0;
}

function isNotionEmojiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    return hostname.startsWith("notion-emojis.") ||
      pathname.includes("/images/emoji/") ||
      pathname.includes("emoji-spritesheet");
  } catch {
    return false;
  }
}
