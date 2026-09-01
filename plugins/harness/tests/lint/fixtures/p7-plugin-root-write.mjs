// Fixture for prohibition 7 (M8). Deliberately violating.
import { writeFileSync } from "node:fs";
export function cache(data) {
  writeFileSync(process.env.CLAUDE_PLUGIN_ROOT + "/cache.json", data);
}
