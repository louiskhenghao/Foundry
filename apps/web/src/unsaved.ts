import { useEffect } from 'react';

/** what the person is editing and has not saved: a page that wants to reload itself asks first while any is open */
const open = new Set<string>();

/** mark `key` as holding unsaved edits while `dirty`; cleared when the component goes away */
export function useUnsaved(key: string, dirty: boolean): void {
  useEffect(() => {
    if (dirty) open.add(key);
    else open.delete(key);
    return () => {
      open.delete(key);
    };
  }, [key, dirty]);
}

export const hasUnsaved = (): boolean => open.size > 0;
