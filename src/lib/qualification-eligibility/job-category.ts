import { normalizeQualificationText } from "./domain";

export interface JobCategoryJob {
  id: string;
  name: string;
}

export interface JobCategory {
  id: string;
  name: string;
  jobs: JobCategoryJob[];
}

const LEVEL_SUFFIXES = [
  /\s+N(?:IVEL|ÍVEL)?\.?\s*(?:\d+|I{1,3}|IV|V)(?:\s+[A-C])?$/i,
  /\s+(?:I{1,3}|IV|V)$/i,
  /\s+[1-5]$/,
  /\s+(?:J[ÚU]NIOR|JR\.?|PLENO|S[ÊE]NIOR|SR\.?)$/i,
] as const;

export function buildJobCategories(jobs: JobCategoryJob[]): JobCategory[] {
  const categories = new Map<string, JobCategory>();

  for (const job of jobs) {
    const categoryName = deriveJobCategoryName(job.name);
    const categoryId = createJobCategoryId(categoryName);
    let category = categories.get(categoryId);
    if (!category) {
      category = { id: categoryId, name: categoryName, jobs: [] };
      categories.set(categoryId, category);
    }
    if (!category.jobs.some((candidate) => candidate.id === job.id)) {
      category.jobs.push(job);
    }
  }

  return [...categories.values()]
    .map((category) => ({
      ...category,
      jobs: category.jobs.sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

export function deriveJobCategoryName(jobName: string): string {
  let category = jobName.trim().replace(/\s+/g, " ");
  for (const suffix of LEVEL_SUFFIXES) {
    category = category.replace(suffix, "").trim();
  }
  return category || jobName.trim();
}

export function createJobCategoryId(categoryName: string): string {
  const slug = normalizeQualificationText(categoryName)
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `job-category:${slug}`;
}
