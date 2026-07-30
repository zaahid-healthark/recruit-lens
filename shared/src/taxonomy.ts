/**
 * Taxonomy-related shared types.
 *
 * The actual editable taxonomy VALUES live in `/server/src/config/taxonomy.ts`
 * (single source of truth, also seeded into the DB) and are served to the
 * mobile app via `GET /taxonomy`.
 */

/** Department name -> list of sub-category names. */
export type TaxonomyMap = Record<string, string[]>;

/** Fallback value used for both department and sub-category when nothing fits. */
export const OTHER_VALUE = "Other";

export interface TaxonomyDepartmentDto {
  name: string;
  subCategories: string[];
}

export interface TaxonomyDto {
  departments: TaxonomyDepartmentDto[];
  /** The fallback classification value ("Other"). */
  fallback: string;
}
