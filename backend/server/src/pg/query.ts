// Translates the SQLite-flavoured placeholders used across the codebase into
// Postgres' numbered ones, without rewriting the 140 existing call sites.
//
//   positional:  SELECT ... WHERE id = ?          + [id]
//   named:       UPDATE ... SET name = :name      + [{ name }]
//
// The scanner skips comments, quoted identifiers, single-quoted literals and
// dollar-quoted blocks, and leaves `::type` casts alone. That matters because
// `::` is valid Postgres syntax and `:name` is not.

export interface RewrittenQuery {
  text: string;
  values: unknown[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

export function rewriteQuery(sql: string, params: unknown[] = []): RewrittenQuery {
  if (params.length === 0) return { text: sql, values: [] };

  const named = params.length === 1 && isPlainObject(params[0]);
  const values: unknown[] = [];
  const indexByName = new Map<string, number>();
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // -- line comment
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // /* block comment */
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // 'literal' with '' escaping
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // "quoted identifier"
    if (ch === '"') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== '"') j += 1;
      j = Math.min(j + 1, sql.length);
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // $tag$ ... $tag$ dollar quoting
    if (ch === '$') {
      const open = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (open) {
        const tag = open[0];
        const close = sql.indexOf(tag, i + tag.length);
        const stop = close === -1 ? sql.length : close + tag.length;
        out += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (ch === '?' && !named) {
      values.push(params[values.length]);
      out += `$${values.length}`;
      i += 1;
      continue;
    }

    if (ch === ':' && named) {
      // Postgres cast: do not treat as a bind parameter.
      if (sql[i + 1] === ':') {
        out += '::';
        i += 2;
        continue;
      }
      const match = /^:([A-Za-z_][A-Za-z0-9_]*)/.exec(sql.slice(i));
      const name = match?.[1];
      if (name) {
        const known = indexByName.get(name);
        const index = known ?? values.length + 1;
        if (known === undefined) {
          indexByName.set(name, index);
          values.push((params[0] as Record<string, unknown>)[name] ?? null);
        }
        out += `$${index}`;
        i += match![0].length;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return { text: out, values };
}
