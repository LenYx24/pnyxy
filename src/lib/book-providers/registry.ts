import type { BookProvider } from "./types";
import { openLibraryProvider } from "./open-library-provider";

const providers: BookProvider[] = [openLibraryProvider];

export function getProviders(): BookProvider[] {
  return providers;
}

export function getProvider(id: string): BookProvider | undefined {
  return providers.find((p) => p.id === id);
}

export function getDefaultProvider(): BookProvider {
  return providers[0];
}
