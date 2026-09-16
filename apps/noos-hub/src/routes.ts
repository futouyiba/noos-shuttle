/**
 * Hash routing for the Work-centered shell.
 *
 * Primary navigation is Work / Vault / System. Harness stays reachable as an
 * advanced diagnostic deep link; the Work Detail fixture lives at
 * #work-detail. Legacy hashes are normalized so old links keep working.
 */
export type SectionId = "work" | "work-detail" | "vault" | "harness" | "system" | "help";

const knownSections: SectionId[] = ["work", "work-detail", "vault", "harness", "system", "help"];

/** Legacy deep-link compatibility: #home → #work, #adapters/#config → #system. #harness is kept as-is. */
const sectionAliases: Partial<Record<string, SectionId>> = {
  home: "work",
  adapters: "system",
  config: "system"
};

export function parseSectionId(value: string | undefined, fallback: SectionId = "work"): SectionId {
  const normalized = value ? sectionAliases[value] ?? value : undefined;
  return knownSections.includes(normalized as SectionId) ? (normalized as SectionId) : fallback;
}

/**
 * Primary-nav highlight mapping: Work Detail stays under Work (Figma 6:4 keeps
 * Work as the active context); Harness intentionally highlights nothing
 * because it is an advanced diagnostic surface.
 */
export function navSectionFor(section: SectionId): SectionId {
  return section === "work-detail" ? "work" : section;
}
