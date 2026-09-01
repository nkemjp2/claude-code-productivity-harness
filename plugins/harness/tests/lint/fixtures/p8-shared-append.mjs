// Fixture for prohibition 8 (M26). Deliberately violating.
import { appendFileSync } from "node:fs";
export function record(line) {
  appendFileSync("/tmp/events.jsonl", line);
}
