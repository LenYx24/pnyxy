// Minimal Deno globals shim for editor type-checking. The actual runtime
// is Deno; tsc never compiles these files (they live outside the Vite
// tsconfig project root). Import once per function for its side effect:
//   import "../_shared/deno-shim.ts";
declare global {
  const Deno: {
    env: { get(key: string): string | undefined };
    serve(handler: (req: Request) => Promise<Response> | Response): void;
    resolveDns(
      query: string,
      recordType: "A" | "AAAA",
    ): Promise<string[]>;
    test(name: string, fn: () => void | Promise<void>): void;
  };
}

export {};
