// GET /v1/plans — catalogue commercial officiel (source de vérité serveur).

import { PLANS, publicPlan } from "../catalog/plans";

export function plans(): Response {
  return Response.json({
    currency: "XOF",
    plans: PLANS.map(publicPlan),
  });
}
