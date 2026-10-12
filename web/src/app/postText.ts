const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#x200B': '', '#x200b': '', '#39': "'" };

const IMAGE_URL = /https?:\/\/(?:preview|i|external-preview)\.redd\.it\/\S+|https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:\?\S*)?/gi;

/** Reddit markdown -> readable plain text (keeps line breaks, drops image links, gifs and formatting marks). */
export function cleanPostText(raw: string): string {
  let t = raw.replace(/&(#x200[Bb]|#39|amp|lt|gt|quot|apos|nbsp);/g, (_, e: string) => ENTITIES[e] ?? '');
  t = t
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) => (label.trim() === url.trim() || /^https?:\/\//.test(label) ? '' : label))
    .replace(IMAGE_URL, '')
    .replace(/\\([_*[\]()#>~`|\\-])/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,!?:;]|$)/gm, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[*+-]\s+(?=\S)/gm, '• ')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
    .replace(/https?:\/\/(?:www\.)?([^/\s]+)\/\S{24,}/g, (_, host: string) => `${host}/…`)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');
  return t.trim();
}
