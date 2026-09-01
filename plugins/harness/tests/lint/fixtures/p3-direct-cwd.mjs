// Fixture for prohibition 3 (M9). Deliberately violating.
export function where() {
  return process.cwd() + String(process.env.CLAUDE_PROJECT_DIR);
}
