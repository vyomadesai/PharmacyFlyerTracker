import './styles.css';
import AppShell from '../src/components/AppShell';

export const metadata = { title: 'MDP Flyer Tracker — Admin' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Navigation lives in src/components/AppShell.tsx (hidden screens are commented out there). */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
