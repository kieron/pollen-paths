// Optional painted sprites. Drop PNGs into src/assets/sprites/ named after the keys in
// src/assets/sprites/README.md and they replace the procedural placeholder art automatically.
const urls = import.meta.glob('./assets/sprites/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const images = new Map<string, HTMLImageElement>();
for (const [path, url] of Object.entries(urls)) {
  const key = path.split('/').pop()!.replace(/\.png$/, '');
  const img = new Image();
  img.src = url;
  images.set(key, img);
}

export function sprite(key: string): HTMLImageElement | undefined {
  const img = images.get(key);
  return img && img.complete && img.naturalWidth > 0 ? img : undefined;
}
