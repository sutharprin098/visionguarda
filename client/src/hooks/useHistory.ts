import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchHistory, clearHistory } from '../utils/api';

export function useHistory() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['history'],
    queryFn: fetchHistory,
    refetchInterval: 5000, // auto-refresh every 5 seconds
    staleTime: 2000,
  });

  const clearMutation = useMutation({
    mutationFn: clearHistory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });

  const historyList = Array.isArray(data) ? data : (data?.history ?? []);
  const historyCount = Array.isArray(data) ? data.length : (data?.count ?? 0);

  return {
    history: historyList,
    count: historyCount,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
    clearHistory: () => clearMutation.mutate(),
    isClearing: clearMutation.isPending,
  };
}
