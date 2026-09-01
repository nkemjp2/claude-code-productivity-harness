/**
 * A strict YAML subset parser (ADR-0008).
 *
 * The runner has zero runtime dependencies and Node ships no YAML parser, so
 * this exists to read `.harness/manifest.yaml`, `policy.yaml` and
 * `contract.yaml`.
 *
 * It supports exactly what the templates use — nested maps, sequences,
 * scalars, quoted strings, comments — and **throws on everything else**.
 * That refusal is the whole design. A subset parser that guesses at an anchor
 * or a folded scalar is M25's failure (passing output it did not understand)
 * relocated into the config loader, where a mis-read blast radius or
 * protected-path list is considerably worse than a wrong gate verdict.
 *
 * A template using an unsupported construct is therefore a build failure, and
 * the templates and this parser evolve together.
 */

export class YamlSubsetError extends Error {
  /**
   * @param {string} message
   * @param {number} line
   */
  constructor(message, line) {
    super(`${message} (line ${line})`);
    this.name = "YamlSubsetError";
    this.line = line;
  }
}

/**
 * Remove an unquoted trailing comment.
 * @param {string} text
 * @returns {string}
 */
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote === null && (c === "'" || c === '"')) quote = c;
    else if (quote !== null && c === quote) quote = null;
    else if (quote === null && c === "#") return text.slice(0, i);
  }
  return text;
}

/** @typedef {{ n: number, indent: number, text: string }} Line */

/**
 * Scalar values, with every unsupported construct rejected rather than read.
 * @param {string} raw
 * @param {number} n
 * @returns {string | number | boolean | null}
 */
function scalar(raw, n) {
  const v = raw.trim();
  if (v === "") return null;

  const first = v[0];
  if (first === "&") throw new YamlSubsetError("anchors are not supported", n);
  if (first === "*") throw new YamlSubsetError("aliases are not supported", n);
  if (first === "!") throw new YamlSubsetError("tags are not supported", n);
  if (first === "|") throw new YamlSubsetError("literal block scalars are not supported", n);
  if (first === ">") throw new YamlSubsetError("folded block scalars are not supported", n);
  if (first === "{") throw new YamlSubsetError("flow mappings are not supported", n);
  if (first === "[") throw new YamlSubsetError("flow sequences are not supported", n);

  if ((first === '"' || first === "'") && v.length >= 2 && v.endsWith(first)) {
    return v.slice(1, -1);
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  return v;
}

/**
 * Split `key: value`, honouring quotes so a colon inside a string is content.
 * @param {string} text
 * @param {number} n
 * @returns {{ key: string, rest: string }}
 */
function splitKey(text, n) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote === null && (c === "'" || c === '"')) quote = c;
    else if (quote !== null && c === quote) quote = null;
    else if (quote === null && c === ":" && (i + 1 === text.length || text[i + 1] === " ")) {
      return { key: text.slice(0, i).trim(), rest: text.slice(i + 1).trim() };
    }
  }
  throw new YamlSubsetError(`expected 'key: value', got '${text}'`, n);
}

/**
 * @param {Line[]} lines
 * @param {number} i
 * @param {number} indent
 * @returns {[unknown, number]}
 */
function parseBlock(lines, i, indent) {
  const line = lines[i];
  if (line === undefined) return [null, i];
  return line.text.startsWith("- ") || line.text === "-"
    ? parseSequence(lines, i, indent)
    : parseMapping(lines, i, indent);
}

/**
 * @param {Line[]} lines
 * @param {number} i
 * @param {number} indent
 * @returns {[Record<string, unknown>, number]}
 */
function parseMapping(lines, i, indent) {
  /** @type {Record<string, unknown>} */
  const out = {};
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new YamlSubsetError(`unexpected indentation; expected ${indent} spaces`, line.n);
    }

    const { key, rest } = splitKey(line.text, line.n);
    if (key === "<<") throw new YamlSubsetError("merge keys are not supported", line.n);

    if (rest !== "") {
      out[key] = scalar(rest, line.n);
      i += 1;
      continue;
    }

    const next = lines[i + 1];
    if (next !== undefined && next.indent > indent) {
      const [child, ni] = parseBlock(lines, i + 1, next.indent);
      out[key] = child;
      i = ni;
    } else {
      out[key] = null;
      i += 1;
    }
  }
  return [out, i];
}

/**
 * @param {Line[]} lines
 * @param {number} i
 * @param {number} indent
 * @returns {[unknown[], number]}
 */
function parseSequence(lines, i, indent) {
  /** @type {unknown[]} */
  const out = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.indent !== indent || !(line.text.startsWith("- ") || line.text === "-")) break;

    const rest = line.text === "-" ? "" : line.text.slice(2).trim();
    const itemIndent = indent + 2;

    // An item that opens a mapping owns every following line indented past it.
    let looksLikeMapping = false;
    if (rest !== "") {
      try {
        splitKey(rest, line.n);
        looksLikeMapping = true;
      } catch {
        looksLikeMapping = false;
      }
    }

    if (!looksLikeMapping) {
      out.push(scalar(rest, line.n));
      i += 1;
      continue;
    }

    /** @type {Line[]} */
    const sub = [{ n: line.n, indent: itemIndent, text: rest }];
    let j = i + 1;
    while (j < lines.length) {
      const follower = lines[j];
      if (follower === undefined || follower.indent < itemIndent) break;
      sub.push(follower);
      j += 1;
    }
    const [item] = parseMapping(sub, 0, itemIndent);
    out.push(item);
    i = j;
  }
  return [out, i];
}

/**
 * Parse a YAML document restricted to the supported subset.
 *
 * @param {string} text
 * @returns {Record<string, unknown>}
 * @throws {YamlSubsetError} on any construct outside the subset
 */
export function parse(text) {
  /** @type {Line[]} */
  const lines = [];
  const rawLines = text.split(/\r?\n/);

  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const n = idx + 1;
    const raw = rawLines[idx] ?? "";

    if (/^\s*$/.test(raw)) continue;
    if (/^[ ]*\t/.test(raw)) {
      throw new YamlSubsetError("tabs may not be used for indentation", n);
    }
    if (raw.startsWith("---") || raw.startsWith("...")) {
      throw new YamlSubsetError("multiple documents are not supported", n);
    }

    const stripped = stripComment(raw);
    if (stripped.trim() === "") continue;

    const indent = stripped.length - stripped.trimStart().length;
    lines.push({ n, indent, text: stripped.trim() });
  }

  if (lines.length === 0) return {};

  const first = lines[0];
  if (first === undefined) return {};
  const [value, consumed] = parseBlock(lines, 0, first.indent);

  if (consumed < lines.length) {
    const stray = lines[consumed];
    throw new YamlSubsetError("inconsistent indentation", stray?.n ?? first.n);
  }
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    throw new YamlSubsetError("the document root must be a mapping", first.n);
  }
  return /** @type {Record<string, unknown>} */ (value);
}
