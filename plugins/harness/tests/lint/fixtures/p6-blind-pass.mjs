// Fixture for prohibition 6 (M25, ADR-0004). Deliberately violating: no
// terminal error path, and a pass returned from a catch.
export const adapter = {
  id: "fixture",
  parse(stdout) {
    try {
      return { verdict: JSON.parse(stdout).ok ? "pass" : "block" };
    } catch (e) {
      return { verdict: "pass" };
    }
  },
};
