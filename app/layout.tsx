import type { Metadata } from 'next';
import './globals.css';
import './politics.css';
export const metadata: Metadata = {
  title: 'EconRise — A world built by players',
  description: 'A real-time, player-driven economic strategy game. Build, trade and collaborate on a shared world map.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
