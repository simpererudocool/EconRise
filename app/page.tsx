import GameClient from '@/components/GameClient';
export default function Page() {
  return <GameClient manualEnabled={!process.env.VERCEL && process.env.ECONRISE_MANUAL_TEST === '1'} />;
}
