import { createContext, useContext } from 'react';

export const ModalAutoFocusContext = createContext(false);

// A modal schedules focus after its focus boundary mounts. Elsewhere native autofocus applies.
export function useAutoFocusProps(autoFocus?: boolean) {
  const inModal = useContext(ModalAutoFocusContext);
  return {
    autoFocus: autoFocus && !inModal,
    'data-ui-autofocus': inModal && autoFocus ? '' : undefined,
  };
}
