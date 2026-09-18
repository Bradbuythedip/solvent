import { Container } from '@/components/ui/primitives';
import { LeaderboardHeader } from '@/app/leaderboard/Header';
import { LeaderboardSkeleton } from '@/app/leaderboard/Skeleton';

export default function Loading() {
  return (
    <div className="pb-20">
      <Container>
        <LeaderboardHeader />
        <LeaderboardSkeleton />
      </Container>
    </div>
  );
}
