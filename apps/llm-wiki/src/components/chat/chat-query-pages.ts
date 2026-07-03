export interface QueryPageRef {
  title: string
  path: string
}

export let lastQueryPages: QueryPageRef[] = []

export function setLastQueryPages(pages: QueryPageRef[]): void {
  lastQueryPages = pages
}
