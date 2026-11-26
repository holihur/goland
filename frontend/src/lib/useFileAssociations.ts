import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadFileAssociations,
  saveFileAssociations,
  viewerForPath,
  type FileAssociationOverrides,
  type ViewerKind,
} from "./fileAssociations";

export function useFileAssociations(userId: string) {
  const [overrides, setOverrides] = useState<FileAssociationOverrides>(() => loadFileAssociations(userId));

  useEffect(() => {
    setOverrides(loadFileAssociations(userId));
  }, [userId]);
  useEffect(() => {
    saveFileAssociations(userId, overrides);
  }, [overrides, userId]);

  const setAssociation = useCallback((target: string, viewer: ViewerKind) => {
    setOverrides((current) => ({ ...current, [target]: viewer }));
  }, []);
  const removeAssociation = useCallback((target: string) => {
    setOverrides((current) => {
      const next = { ...current };
      delete next[target];
      return next;
    });
  }, []);
  const resetAssociations = useCallback(() => setOverrides({}), []);
  const viewerFor = useCallback((path: string) => viewerForPath(path, overrides), [overrides]);

  return useMemo(
    () => ({ overrides, setAssociation, removeAssociation, resetAssociations, viewerFor }),
    [overrides, setAssociation, removeAssociation, resetAssociations, viewerFor],
  );
}
