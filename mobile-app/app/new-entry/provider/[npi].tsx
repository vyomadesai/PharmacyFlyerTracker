import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

/** Legacy single-provider route — use org-first flow at /new-entry/org/[npi] instead. */
export default function LegacyNewEntryProviderRedirect() {
  const { npi } = useLocalSearchParams<{ npi: string }>();

  useEffect(() => {
    if (npi) {
      router.replace(`/new-entry/org/${npi}`);
      return;
    }
    router.replace('/new-entry');
  }, [npi]);

  return null;
}
