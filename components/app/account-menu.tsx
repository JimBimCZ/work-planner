'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOutAction } from '@/lib/actions/session';
import { avatarHue, initials } from '@/lib/avatar';

type Preference = 'system' | 'light' | 'dark';

// The pre-paint script owns data-theme and reads localStorage, so the stored
// preference is the source of truth here — data-theme cannot distinguish "the
// user chose light" from "the system is light".
let listeners: Array<() => void> = [];

function subscribe(onChange: () => void) {
  listeners = [...listeners, onChange];
  return () => {
    listeners = listeners.filter((listener) => listener !== onChange);
  };
}

function getSnapshot(): Preference {
  const stored = localStorage.getItem('theme');
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function getServerSnapshot(): Preference {
  return 'system';
}

function applyPreference(next: Preference) {
  if (next === 'system') {
    // Clearing the key is what makes the pre-paint script's matchMedia fallback
    // reachable again; a stored value would pin the choice forever.
    localStorage.removeItem('theme');
    document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)')
      .matches
      ? 'dark'
      : 'light';
  } else {
    localStorage.setItem('theme', next);
    document.documentElement.dataset.theme = next;
  }
  listeners.forEach((listener) => listener());
}

export function AccountMenu({
  userId,
  name,
  email,
  image,
}: {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
}) {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="flex size-7 items-center justify-center overflow-hidden rounded-full text-xs font-medium"
        style={image ? undefined : { backgroundColor: `hsl(${avatarHue(userId)} 45% 32%)` }}
      >
        {image ? (
          <Image src={image} alt="" width={28} height={28} />
        ) : (
          <span className="text-white">{initials(name, email)}</span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-56">
        <p className="px-2 py-1.5 text-xs text-muted">{email}</p>
        <DropdownMenuSeparator />

        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => applyPreference(value as Preference)}
        >
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">Account</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/privacy">Privacy</Link>
        </DropdownMenuItem>
        <form action={signOutAction}>
          <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
            <button type="submit" className="w-full text-left">
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
