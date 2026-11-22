// Just enough of Deno's types to type-check the edge functions with the project's TypeScript
// (npm run typecheck:functions). Supabase runs them on real Deno.
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
