import { useQuery } from '@tanstack/react-query';
import { workspaceRequest } from './workspace-ui';

export type WorkspaceSummary = {
  plan: string;
  planName: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  usage: Record<string, number>;
  customers: number;
  optedInCustomers: number;
  orderCount: number;
  revenue: number | null;
  publishedProducts: number;
  pendingOrders: number;
  lowStockProducts: number;
  jobs: Record<string, number>;
  recentOrders: { id: string; customerName: string; status: string; paymentStatus: string; total: number | null; createdAt: string }[];
  telegram: {
    linked: boolean;
    live: boolean;
    status: string;
    username: string | null;
    lastSuccessfulPollAt: string | null;
    hasError: boolean;
    published: boolean;
    revision: number;
  };
  isOwner: boolean;
};

// Shell alerts and the lazy overview share the same cache without importing charts.
export function useWorkspaceSummary(storeId: string, enabled = true) {
  return useQuery({
    queryKey: ['workspace-summary', storeId],
    enabled: !!storeId && enabled,
    queryFn: () => workspaceRequest<WorkspaceSummary>(`/api/stores/${encodeURIComponent(storeId)}/workspace-summary`),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}
