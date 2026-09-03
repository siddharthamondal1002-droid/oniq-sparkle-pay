/**
 * React Query hooks over src/lib/watch/library.ts. One key prefix, one
 * invalidation, so every surface refreshes together after a write.
 */
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  countWatchLibrary,
  listAnalysisPool,
  listCollectionLinks,
  listCollections,
  listContinue,
  listMoments,
  listThreadLinks,
  listThreads,
  listWatchItems,
  type Cursor,
  type ListFilters,
  type ListOrder,
} from "@/lib/watch/library";

export const WATCH_KEY = ["watch-lib"] as const;

export function useInvalidateWatch() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: WATCH_KEY }), [qc]);
}

export function useWatchItems(
  userId: string | null,
  filters: ListFilters,
  order: ListOrder = "saved",
) {
  return useInfiniteQuery({
    queryKey: [...WATCH_KEY, "items", userId, order, filters],
    enabled: !!userId,
    initialPageParam: null as Cursor,
    queryFn: ({ pageParam }) => listWatchItems(filters, pageParam, order),
    getNextPageParam: (last) => last.next,
    staleTime: 30 * 1000,
  });
}

/** Inbox and unfinished counts for the Home card. Same key prefix, same invalidation. */
export function useWatchCounts(userId: string | null) {
  return useQuery({
    queryKey: [...WATCH_KEY, "counts", userId],
    enabled: !!userId,
    queryFn: () => countWatchLibrary(),
    staleTime: 30 * 1000,
  });
}

export function useContinue(userId: string | null) {
  return useQuery({
    queryKey: [...WATCH_KEY, "continue", userId],
    enabled: !!userId,
    queryFn: () => listContinue(),
    staleTime: 30 * 1000,
  });
}

/** The bounded pool the pure analyses run on (resurface, queue, health). */
export function useAnalysisPool(userId: string | null) {
  return useQuery({
    queryKey: [...WATCH_KEY, "pool", userId],
    enabled: !!userId,
    queryFn: () => listAnalysisPool(),
    staleTime: 60 * 1000,
  });
}

export function useCollections(userId: string | null) {
  return useQuery({
    queryKey: [...WATCH_KEY, "collections", userId],
    enabled: !!userId,
    queryFn: () => listCollections(),
    staleTime: 60 * 1000,
  });
}

export function useCollectionLinks(userId: string | null) {
  return useQuery({
    queryKey: [...WATCH_KEY, "collection-links", userId],
    enabled: !!userId,
    queryFn: () => listCollectionLinks(),
    staleTime: 60 * 1000,
  });
}

export function useThreads(userId: string | null) {
  return useQuery({
    queryKey: [...WATCH_KEY, "threads", userId],
    enabled: !!userId,
    queryFn: () => listThreads(),
    staleTime: 60 * 1000,
  });
}

export function useThreadLinks(userId: string | null) {
  return useQuery({
    queryKey: [...WATCH_KEY, "thread-links", userId],
    enabled: !!userId,
    queryFn: () => listThreadLinks(),
    staleTime: 60 * 1000,
  });
}

export function useMoments(userId: string | null, itemId: string | null) {
  return useQuery({
    queryKey: [...WATCH_KEY, "moments", userId, itemId],
    enabled: !!userId && !!itemId,
    queryFn: () => listMoments(itemId as string),
    staleTime: 30 * 1000,
  });
}
