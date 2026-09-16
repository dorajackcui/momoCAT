import { createContext } from 'react';

// Popups inside a modal belong to its focus and accessibility boundary.
export const OverlayContainerContext = createContext<HTMLElement | null>(null);
