// Fixture for prohibition 2 (M3). Deliberately violating.
export function check() {
  console.log("this corrupts the decision payload");
  process.stdout.write("{}");
}
