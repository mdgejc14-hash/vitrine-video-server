// CATALOGUE COMMERCIAL OFFICIEL — unique source de vérité des prix,
// crédits et durées. Le client Android ne peut rien choisir ici : il
// transmet uniquement un product_code, le serveur applique ces valeurs.

export interface Plan {
  code: PlanCode;
  kind: "free" | "pass";
  label: string;
  price_xof: number; // entier XOF
  credits: number;
  duration_s: number | null; // null = sans expiration (FREE_INSTALL)
}

export type PlanCode =
  | "FREE_INSTALL"
  | "PASS_EXPRESS"
  | "PASS_PRO"
  | "PASS_BOUTIQUE";

export const PLANS: readonly Plan[] = Object.freeze([
  Object.freeze({
    code: "FREE_INSTALL",
    kind: "free",
    label: "Découverte gratuite",
    price_xof: 0,
    credits: 3,
    duration_s: null,
  }),
  Object.freeze({
    code: "PASS_EXPRESS",
    kind: "pass",
    label: "Pass Express",
    price_xof: 500,
    credits: 6,
    duration_s: 86_400, // 24 heures exactement
  }),
  Object.freeze({
    code: "PASS_PRO",
    kind: "pass",
    label: "Pass Pro",
    price_xof: 3_000,
    credits: 90,
    duration_s: 2_592_000, // 30 jours exactement (mois commercial)
  }),
  Object.freeze({
    code: "PASS_BOUTIQUE",
    kind: "pass",
    label: "Pass Boutique",
    price_xof: 7_500,
    credits: 200,
    duration_s: 2_592_000, // 30 jours exactement
  }),
]);

export function findPlan(code: string): Plan | undefined {
  return PLANS.find((p) => p.code === code);
}

export function isPaidPass(code: string): boolean {
  const p = findPlan(code);
  return p !== undefined && p.kind === "pass";
}

/** Représentation publique d'une formule (jamais de détail interne). */
export function publicPlan(p: Plan): {
  code: PlanCode;
  label: string;
  kind: "free" | "pass";
  price_xof: number;
  currency: "XOF";
  credits: number;
  duration_s: number | null;
} {
  return {
    code: p.code,
    label: p.label,
    kind: p.kind,
    price_xof: p.price_xof,
    currency: "XOF",
    credits: p.credits,
    duration_s: p.duration_s,
  };
}
