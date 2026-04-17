import { useNavigate } from "react-router";
import { Users } from "lucide-react";
import { GlassCard } from "@/components/ui";
import type { Community } from "@/types/forum";

interface CommunityCardProps {
  community: Community;
}

export function CommunityCard({ community }: CommunityCardProps) {
  const navigate = useNavigate();

  return (
    <GlassCard
      className="cursor-pointer p-4"
      onClick={() => navigate(`/forum/c/${community.slug}`)}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-purple/20 text-accent-purple font-bold text-sm">
          {community.name.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-text-primary">
            {community.name}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-text-muted">
            <Users size={12} />
            {community.member_count} {community.member_count === 1 ? "member" : "members"}
          </p>
          {community.description && (
            <p className="mt-1.5 line-clamp-2 text-xs text-text-secondary">
              {community.description}
            </p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
