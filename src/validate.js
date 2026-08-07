'use strict';

// Tiny JSON-schema-like validator. Anything to Git does not depend on Ajv;
// adapters ship a `schema` declaration that is enough to fail fast on
// required fields, types, enums, and string length. Anything more
// sophisticated should be done in the adapter itself.

function validate(tree, schema) {
  const errors = [];
  walk(tree, schema, '$', errors);
  return { ok: errors.length === 0, errors };
}

function walk(value, schema, pointer, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type) {
    const t = jsType(value);
    if (Array.isArray(schema.type)) {
      if (!schema.type.includes(t)) errors.push(error(pointer, `type must be one of ${schema.type.join(',')}, got ${t}`));
    } else if (t !== schema.type) {
      errors.push(error(pointer, `type must be ${schema.type}, got ${t}`));
    }
  }

  if (schema.required && schema.type === 'object') {
    for (const k of schema.required) {
      if (!(k in (value || {}))) errors.push(error(`${pointer}/${k}`, 'required field missing'));
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(error(pointer, `value must be one of ${JSON.stringify(schema.enum)}`));
  }

  if (schema.type === 'string' && typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(error(pointer, `string shorter than minLength ${schema.minLength}`));
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      errors.push(error(pointer, `string longer than maxLength ${schema.maxLength}`));
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(error(pointer, `string does not match pattern ${schema.pattern}`));
    }
  }

  if (schema.type === 'object' && value && typeof value === 'object') {
    const props = schema.properties || {};
    for (const k of Object.keys(props)) {
      walk(value[k], props[k], `${pointer}/${k}`, errors);
    }
  }

  // Recurse into `properties` even when type is undeclared, as long as the
  // value looks like an object — common in hand-written adapter schemas.
  if (!schema.type && value && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties || {};
    for (const k of Object.keys(props)) {
      walk(value[k], props[k], `${pointer}/${k}`, errors);
    }
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push(error(pointer, `array has fewer than minItems ${schema.minItems}`));
    }
    if (schema.items) {
      value.forEach((v, i) => walk(v, schema.items, `${pointer}/${i}`, errors));
    }
  }
}

function jsType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function error(path, msg) {
  return { path, message: msg };
}

module.exports = { validate };
