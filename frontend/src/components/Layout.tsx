import { ReactNode } from 'react';
import {
  IconBroadcast,
  IconCode,
  IconDice,
  IconHistory,
  IconScan,
  IconSettings,
  IconMenu2,
} from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MiniNavRail } from './MiniNavRail';

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  {
    icon: IconScan,
    label: 'New Scan',
    description: 'Configure and start a new scan',
    path: '/',
    hotkey: 'Alt+1',
  },
  {
    icon: IconDice,
    label: 'Keno B2B',
    description: 'Find high B2B multiplier streaks',
    path: '/keno-b2b',
    hotkey: 'Alt+2',
  },
  {
    icon: IconHistory,
    label: 'History',
    description: 'View previous scan results',
    path: '/runs',
    hotkey: 'Alt+3',
  },
  {
    icon: IconBroadcast,
    label: 'Live',
    description: 'Monitor live betting streams',
    path: '/live',
    hotkey: 'Alt+4',
  },
  {
    icon: IconCode,
    label: 'Script',
    description: 'Automated betting strategies',
    path: '/script',
    hotkey: 'Alt+5',
  },
  {
    icon: IconSettings,
    label: 'Accounts',
    description: 'Stake auth & connection checks',
    path: '/settings',
    hotkey: 'Alt+6',
  },
];

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isFullBleedScan = location.pathname === '/';
  const isFullBleedLiveDetail = /^\/live\/[^/]+$/.test(location.pathname);

  if (isFullBleedScan || isFullBleedLiveDetail) {
    return <>{children}</>;
  }

  // Get current page title
  const currentNav = navItems.find(
    (item) =>
      location.pathname === item.path ||
      (item.path !== '/' && location.pathname.startsWith(item.path))
  );
  const pageTitle = currentNav?.label ?? 'Dashboard';

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans">
      {/* Left nav rail */}
      <MiniNavRail items={navItems} />

      {/* Main content area */}
      <div className="flex min-h-screen flex-1 flex-col relative">
        {/* Clean minimal background - no textures */}

        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between gap-4 px-6">
            {/* Left: Branding + Current location */}
            <div className="flex items-center gap-4">
              {/* Mobile menu */}
              <div className="md:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9">
                      <IconMenu2 size={18} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {navItems.map((item) => {
                      const active =
                        location.pathname === item.path ||
                        (item.path !== '/' && location.pathname.startsWith(item.path));
                      return (
                        <DropdownMenuItem
                          key={item.path}
                          className={cn('flex items-center gap-3', active && 'bg-primary/10 text-primary')}
                          onSelect={() => navigate(item.path)}
                        >
                          <item.icon size={16} />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{item.label}</span>
                            <span className="text-xs text-muted-foreground">{item.description}</span>
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Title section */}
              <div className="flex items-center gap-3">
                <div className="hidden items-center gap-1.5 sm:flex">
                  <span className="font-display text-sm font-bold tracking-tight text-foreground">
                    W<span className="text-primary">?</span>
                  </span>
                </div>
                <span className="hidden text-muted-foreground/30 sm:block">/</span>
                <h1 className="font-display text-sm uppercase tracking-wider text-foreground">{pageTitle}</h1>
              </div>
            </div>

            {/* Right: Status + Theme */}
            <div className="flex items-center gap-3">
              {/* Status badges - hidden on mobile */}
              <div className="hidden items-center gap-2 sm:flex">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span className="status-dot online" />
                  <span>Local</span>
                </div>
                <div className="h-4 w-px bg-border" />
              </div>

              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 bg-grid-subtle">
          <div className="mx-auto w-full max-w-[1400px] p-6 lg:p-8">
            <div className="animate-fade-in stagger-children">{children}</div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-border bg-background/50">
          <div className="mx-auto flex h-10 w-full max-w-[1400px] items-center justify-between px-6">
            <span className="font-mono text-[10px] text-muted-foreground">
              WEN? • Provable Fairness Analysis
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              v1.0.0
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
