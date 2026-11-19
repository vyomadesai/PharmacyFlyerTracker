import { Pressable, Text, View } from 'react-native';
import { newEntryStyles as styles } from './styles';

export const REVIEW_PAGE_SIZE = 10;

export function paginateList<T>(items: T[], page: number, pageSize = REVIEW_PAGE_SIZE) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    pageItems: items.slice(start, start + pageSize),
    totalItems,
    totalPages,
    safePage,
    pageSize,
    showingFrom: totalItems ? start + 1 : 0,
    showingTo: Math.min(start + pageSize, totalItems),
  };
}

type ListPaginationProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  showingFrom: number;
  showingTo: number;
  onPageChange: (page: number) => void;
};

export default function ListPagination({
  page,
  totalPages,
  totalItems,
  showingFrom,
  showingTo,
  onPageChange,
}: ListPaginationProps) {
  if (totalItems <= REVIEW_PAGE_SIZE) return null;

  return (
    <View style={styles.paginationBar}>
      <Text style={styles.paginationMeta}>
        Showing {showingFrom}–{showingTo} of {totalItems}
      </Text>
      <View style={styles.paginationControls}>
        <Pressable
          style={[styles.paginationBtn, page <= 1 && styles.paginationBtnDisabled]}
          onPress={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <Text style={[styles.paginationBtnText, page <= 1 && styles.paginationBtnTextDisabled]}>Previous</Text>
        </Pressable>
        <Text style={styles.paginationPage}>
          Page {page} of {totalPages}
        </Text>
        <Pressable
          style={[styles.paginationBtn, page >= totalPages && styles.paginationBtnDisabled]}
          onPress={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          <Text style={[styles.paginationBtnText, page >= totalPages && styles.paginationBtnTextDisabled]}>Next</Text>
        </Pressable>
      </View>
    </View>
  );
}
