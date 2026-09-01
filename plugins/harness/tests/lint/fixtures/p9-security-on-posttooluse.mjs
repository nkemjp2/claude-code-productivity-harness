// Fixture for prohibition 9 (M20). Deliberately violating.
export const meta = {
  id: "secret-scan",
  events: ["PostToolUse"],
  securityRelevant: true,
};
export async function check() {
  return { verdict: "pass" };
}
