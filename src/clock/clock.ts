// Abstraction Clock — l'unique source de temps du backend.
// La mission impose de pouvoir contrôler les dates d'expiration en test
// sans modifier l'horloge réelle : tous les services reçoivent une
// Clock. En production : SystemClock (Date.now()). En test : FixedClock
// (avance manuelle). La règle officielle d'expiration est strictement
// `now < expires_at` (à l'instant now == expires_at, le lot est expiré).

export interface Clock {
  now(): Date;
}

export function toIso(d: Date): string {
  return d.toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(d: Date): void {
    this.current = new Date(d.getTime());
  }
}

/** now < expires_at : valide strictement AVANT l'expiration exacte. */
export function isExpired(expiresAt: string | null | undefined, now: Date): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  return toIso(now) >= expiresAt;
}
