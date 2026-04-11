import { Link } from "react-router";
import { Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";

export function HeroSection() {
  const { user } = useAuthStore();

  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center px-6 text-center">
      {/* Floating geometric shapes */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[15%] top-[20%] h-24 w-24 rotate-45 rounded-lg border border-accent-purple/20 animate-[float_6s_ease-in-out_infinite]" />
        <div className="absolute right-[20%] top-[30%] h-16 w-16 rounded-full border border-accent-blue/20 animate-[float_8s_ease-in-out_infinite_1s]" />
        <div className="absolute bottom-[25%] left-[25%] h-20 w-20 rotate-12 border border-accent-purple/15 animate-[float_7s_ease-in-out_infinite_2s]" />
        <div className="absolute bottom-[30%] right-[15%] h-12 w-12 rotate-45 rounded-lg border border-accent-blue/15 animate-[float_9s_ease-in-out_infinite_0.5s]" />
      </div>

      <h1 className="mb-6 text-6xl font-bold tracking-tight sm:text-7xl md:text-8xl">
        <span className="bg-gradient-to-r from-accent-purple via-accent-blue to-accent-purple bg-clip-text text-transparent">
          Pnyxy
        </span>
      </h1>

      <p className="mb-4 max-w-2xl text-xl text-text-secondary sm:text-2xl">
        Your intelligent reading companion
      </p>
      <p className="mb-10 max-w-xl text-base text-text-muted">
        A free, open-source platform that transforms how you read, learn, and
        retain knowledge from books.
      </p>

      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-4">
          <Link to={user ? "/app/library" : "/auth"}>
            <Button variant="primary">Get Started</Button>
          </Link>
          <Button variant="secondary">Learn More</Button>
        </div>
        {!user && (
          <Link
            to="/app/library"
            className="text-sm text-text-muted transition-colors hover:text-text-secondary"
          >
            Continue without an account &rarr;
          </Link>
        )}
      </div>
    </section>
  );
}
