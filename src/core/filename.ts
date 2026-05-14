export function createThreadFilename(title: string, date = new Date()): string {
  const isoDate = date.toISOString().slice(0, 10);
  const slug = slugify(title) || "noos-thread";
  return `${isoDate}-${slug}.md`;
}

export function createCrystalFilename(titleOrKey: string, date = new Date()): string {
  const isoDate = date.toISOString().slice(0, 10);
  const slug = slugify(titleOrKey) || "noos-crystal";
  return `${isoDate}-${slug}.md`;
}

export function createPreferredPath(title: string, date = new Date()): string {
  return `.noos/handoffs/active/${createThreadFilename(title, date)}`;
}

export function createCrystalPreferredPath(titleOrKey: string, date = new Date()): string {
  return `.noos/crystals/active/${createCrystalFilename(titleOrKey, date)}`;
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}
