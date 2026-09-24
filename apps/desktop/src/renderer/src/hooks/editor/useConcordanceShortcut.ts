import { useEffect, useState } from 'react';

export interface ConcordanceShortcutController {
  activeTab: 'tm' | 'concordance' | 'qa';
  setActiveTab: (tab: 'tm' | 'concordance' | 'qa') => void;
  concordanceFocusSignal: number;
  concordanceSearchSignal: number;
  concordanceQuery: string;
}

export function useConcordanceShortcut(): ConcordanceShortcutController {
  const [activeTab, setActiveTab] = useState<'tm' | 'concordance' | 'qa'>('tm');
  const [concordanceFocusSignal, setConcordanceFocusSignal] = useState(0);
  const [concordanceSearchSignal, setConcordanceSearchSignal] = useState(0);
  const [concordanceQuery, setConcordanceQuery] = useState('');

  useEffect(() => {
    const getSelectedTextForConcordance = (): string => {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLInputElement
      ) {
        const start = activeElement.selectionStart ?? 0;
        const end = activeElement.selectionEnd ?? 0;
        if (end > start) {
          return activeElement.value.slice(start, end).replace(/\s+/g, ' ').trim();
        }
      }

      const fallbackSelection = window.getSelection()?.toString() ?? '';
      return fallbackSelection.replace(/\s+/g, ' ').trim();
    };

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      const selectedText = getSelectedTextForConcordance();
      setActiveTab('concordance');
      setConcordanceFocusSignal((value) => value + 1);
      if (selectedText) {
        setConcordanceQuery(selectedText);
        setConcordanceSearchSignal((value) => value + 1);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  return {
    activeTab,
    setActiveTab,
    concordanceFocusSignal,
    concordanceSearchSignal,
    concordanceQuery,
  };
}
