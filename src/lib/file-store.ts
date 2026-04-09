const files = new Map<string, File>();

export function registerFile(id: string, file: File) {
  files.set(id, file);
}

export function getFile(id: string): File | undefined {
  return files.get(id);
}
