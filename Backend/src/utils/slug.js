export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ASCII slug. Titles with no latin letters/digits (e.g. Arabic) fall back to "course".
export const slugify = (text) => {
  const s = String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return s || "course";
};
