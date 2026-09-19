import { Button } from './ui';
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
    <Button
      size="xs"
      tone="neutral"
      variant="soft"
      type="button"
      onClick={() => onOpen(filePath)}
      title={filePath}
      aria-label={`Open linked file ${filename}`}
    >
      ⟳ {filename}
    </Button>
  );
};
