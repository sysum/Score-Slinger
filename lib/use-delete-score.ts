import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/query-client";
import { analytics } from "@/lib/analytics";
import { useToast } from "@/contexts/ToastContext";

const SCORES_KEY = ["/api/scores"];

export const DELETE_ERROR_MESSAGE = "Couldn't delete — check your connection and try again.";

type DeleteSource = "history" | "detail";

/**
 * Shared delete flow for the History and Score Detail confirm modals.
 *
 * - `isDeleting` drives the in-progress UI (spinner, disabled buttons).
 * - A ref guard makes deleteScore() a no-op while a request is in flight, so a
 *   double-tap can't send two DELETEs (state updates are async; the ref isn't).
 * - A 404 counts as success: the score is already gone (e.g. a duplicate request).
 * - On success: removes the row from the ["/api/scores"] cache, invalidates it,
 *   fires `score_deleted` once and shows the "Score deleted" toast.
 * - On failure: rolls back the optimistic removal, fires `score_delete_failed`
 *   and sets `error` for the modal to show inline.
 *
 * Resolves true on success, false on failure or if a delete was already in flight.
 */
export function useDeleteScore(source: DeleteSource) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const inFlightRef = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeFromCache = (scoreId: string) => {
    queryClient.setQueryData<{ id: string }[]>(SCORES_KEY, (old) =>
      old?.filter((s) => s.id !== scoreId),
    );
  };

  const deleteScore = async (
    scoreId: string,
    { optimistic = false }: { optimistic?: boolean } = {},
  ): Promise<boolean> => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    setIsDeleting(true);
    setError(null);

    let previous: unknown;
    if (optimistic) {
      // Stop an in-flight refetch from overwriting the optimistic removal.
      await queryClient.cancelQueries({ queryKey: SCORES_KEY });
      previous = queryClient.getQueryData(SCORES_KEY);
      removeFromCache(scoreId);
    }

    let alreadyDeleted = false;
    try {
      await apiRequest("DELETE", `/api/scores/${scoreId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        alreadyDeleted = true;
      } else {
        if (optimistic && previous !== undefined) {
          queryClient.setQueryData(SCORES_KEY, previous);
        }
        analytics.track("score_delete_failed", {
          source,
          scoreId,
          error: err instanceof Error ? err.message : String(err),
        });
        setError(DELETE_ERROR_MESSAGE);
        setIsDeleting(false);
        inFlightRef.current = false;
        return false;
      }
    }

    removeFromCache(scoreId);
    queryClient.invalidateQueries({ queryKey: SCORES_KEY });
    analytics.track("score_deleted", {
      source,
      scoreId,
      ...(alreadyDeleted ? { already_deleted: true } : {}),
    });
    showToast("Score deleted");
    setIsDeleting(false);
    inFlightRef.current = false;
    return true;
  };

  const clearError = () => setError(null);

  return { deleteScore, isDeleting, error, clearError };
}
