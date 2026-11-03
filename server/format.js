/** Split Markdown into Discord-safe messages without cutting words. */
export function chunkForDiscord(text, limit = 1900) {
  const source = String(text || "").trim();
  if (!source) return [];
  if (source.length <= limit) return [source];

  const chunks = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const paragraph of source.split(/\n{2,}/)) {
    if (paragraph.length > limit) {
      for (const line of paragraph.split("\n")) {
        if ((current + "\n" + line).length > limit) flush();
        if (line.length > limit) {
          let rest = line;
          while (rest.length > limit) {
            chunks.push(rest.slice(0, limit));
            rest = rest.slice(limit);
          }
          current = rest;
        } else {
          current = current ? `${current}\n${line}` : line;
        }
      }
      flush();
      continue;
    }
    if ((current + "\n\n" + paragraph).length > limit) flush();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();
  return chunks;
}

export function discordTime(iso) {
  if (!iso) return null;
  const seconds = Math.floor(new Date(iso).getTime() / 1000);
  return Number.isFinite(seconds) ? `<t:${seconds}:f>` : null;
}

export function truncate(text, max) {
  const value = String(text || "");
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
