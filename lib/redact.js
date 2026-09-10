// Strips specific personal names out of any free text before it's ever saved, so they can
// never end up on the dashboard regardless of which field (a takeaway, a property note, a
// resolved-flag note, a meter label, ...) someone typed them into. Add names here as needed.
const REDACT_NAMES = ['Allen', 'Conor'];
const PATTERN = new RegExp(`\\b(${REDACT_NAMES.join('|')})\\b`, 'gi');

function redactText(s) {
  if (typeof s !== 'string') return s;
  return s.replace(PATTERN, '[name removed]');
}

// Walks any JSON-shaped value (string/number/boolean/null/array/object) and redacts every
// string it finds, recursively — safe to run over an entire app_state `value` blob or a
// readings record without needing to know its exact shape in advance.
function redactDeep(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}

module.exports = { redactText, redactDeep };
