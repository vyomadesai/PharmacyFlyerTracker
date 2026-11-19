export type PaginationParams = {
  page: number;
  pageSize: number;
  offset: number;
};

export function parsePaginationQuery(query: Record<string, unknown>): PaginationParams | null {
  const pageRaw = query.page;
  if (pageRaw == null || pageRaw === '') return null;

  const page = Math.max(1, Number(pageRaw) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(query.pageSize ?? query.limit) || 25),
  );

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function buildPaginatedResponse<T>(
  items: T[],
  total: number,
  pagination: PaginationParams,
) {
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  return {
    items,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages,
  };
}
