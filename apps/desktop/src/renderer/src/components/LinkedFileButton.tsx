import React from 'react';

export function fileBaseName(filePath: string): string {
  const segments = filePath.split(/[\\/]/u);
  return segments[segments.length - 1] || filePath;
}

interface LinkedFileButtonProps {
  filePath: string;
  onOpen: (filePath: string) => void;
}

export const LinkedFileButton: React.FC<LinkedFileButtonProps> = ({ filePath, onOpen }) => {
  const filename = fileBaseName(filePath);

  return (
    <button
      type="button"
      onClick={() => onOpen(filePath)}
      className="text-[10px] font-semibold text-success bg-success-soft px-1.5 py-0.5 rounded-control tracking-wider hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-success/50"
      title={filePath}
      aria-label={`Open linked file ${filename}`}
    >
      ⟳ {filename}
    </button>
  );
};
