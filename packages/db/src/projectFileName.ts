import { extname } from 'path';

function hasInvalidFileNameCharacters(name: string): boolean {
  return (
    /[<>:"/\\|?*]/u.test(name) || Array.from(name).some((character) => character.charCodeAt(0) < 32)
  );
}

export function normalizeProjectFileName(currentName: string, requestedName: string): string {
  const trimmedName = requestedName.trim();
  if (!trimmedName) throw new Error('File name cannot be empty.');
  if (trimmedName === '.' || trimmedName === '..' || hasInvalidFileNameCharacters(trimmedName)) {
    throw new Error('File name contains invalid characters.');
  }

  const extension = extname(currentName);
  if (!extension) return trimmedName;

  const extensionLower = extension.toLowerCase();
  if (!trimmedName.toLowerCase().endsWith(extensionLower)) {
    throw new Error(`File extension must remain "${extension}".`);
  }

  let baseName = trimmedName.slice(0, -extension.length).trim();
  if (baseName.toLowerCase().endsWith(extensionLower)) {
    baseName = baseName.slice(0, -extension.length).trim();
  }
  if (!baseName) throw new Error('File name cannot be empty.');

  return `${baseName}${extension}`;
}
