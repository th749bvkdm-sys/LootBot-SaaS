import pack from "../content/chemistry-v1.json" with { type: "json" };
export type ChemistryReaction = (typeof pack.reactions)[number];
export const chemistryPack = pack;
export function reactionFor(reactants: string[], condition: string) {
  return (
    pack.reactions.find(
      (r) =>
        r.condition === condition &&
        r.reactants
          .map((s) => s.formula)
          .sort()
          .join("|") === [...reactants].sort().join("|"),
    ) ?? null
  );
}
export function atomTotals(
  species: { formula: string; coefficient: number }[],
) {
  const totals: Record<string, number> = {};
  for (const s of species) {
    const substance = pack.substances.find((v) => v.id === s.formula);
    if (
      !substance ||
      !Number.isInteger(s.coefficient) ||
      s.coefficient < 1 ||
      s.coefficient > 20
    )
      throw Error("Unsupported formula or coefficient");
    for (const [element, count] of Object.entries(substance.atoms))
      totals[element] = (totals[element] ?? 0) + s.coefficient * (count ?? 0);
  }
  return Object.fromEntries(
    Object.entries(totals)
      .filter(([, v]) => v > 0)
      .sort(),
  );
}
export function conserved(r: ChemistryReaction, coefficients?: number[]) {
  const all = [...r.reactants, ...r.products];
  if (coefficients && coefficients.length !== all.length) return false;
  try {
    const left = atomTotals(
      r.reactants.map((s, i) => ({
        ...s,
        coefficient: coefficients?.[i] ?? s.coefficient,
      })),
    );
    const right = atomTotals(
      r.products.map((s, i) => ({
        ...s,
        coefficient: coefficients?.[r.reactants.length + i] ?? s.coefficient,
      })),
    );
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
export function equation(r: ChemistryReaction) {
  const side = (values: typeof r.reactants) =>
    values
      .map(
        (v) =>
          (v.coefficient === 1 ? "" : v.coefficient) +
          v.formula +
          "(" +
          v.phase +
          ")",
      )
      .join(" + ");
  return side(r.reactants) + " → " + side(r.products);
}
export function chemistryCheck(input: {
  reactants: string[];
  condition: string;
  predictsReaction: boolean;
  coefficients?: number[];
}) {
  const r = reactionFor(input.reactants, input.condition);
  if (!r)
    return {
      supported: false,
      message: "غير مدعوم / لم يُتحقق منه بعد. اختر نموذجًا موثقًا من القائمة.",
    };
  return {
    supported: true,
    reaction: r,
    equation: equation(r),
    predictionCorrect: input.predictsReaction === r.reaction,
    balanced: conserved(r, input.coefficients),
    coefficients:
      input.coefficients ??
      [...r.reactants, ...r.products].map((s) => s.coefficient),
    before: atomTotals(
      r.reactants.map((s, i) => ({
        ...s,
        coefficient: input.coefficients?.[i] ?? s.coefficient,
      })),
    ),
    after: atomTotals(
      r.products.map((s, i) => ({
        ...s,
        coefficient:
          input.coefficients?.[r.reactants.length + i] ?? s.coefficient,
      })),
    ),
    source: pack.source,
    review: pack.review,
  };
}
if (pack.reactions.some((r) => !conserved(r)))
  throw Error("Chemistry content failed conservation validation");
