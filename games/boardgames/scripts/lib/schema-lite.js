'use strict';

/*
 * Minimal, dependency-free JSON Schema (2020-12 subset) validator.
 *
 * It intentionally supports only the keywords used by
 * boardgames/schema/game.schema.json:
 *   type (string or array), required, properties, additionalProperties,
 *   items, minItems, maxItems, uniqueItems, enum, pattern, minLength,
 *   minimum, maximum, oneOf, anyOf.
 *
 * This is enough to keep the catalog honest without adding npm packages.
 * Returned errors are { path, message } objects.
 */

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number' && isFinite(value)) return 'number';
  return typeof value;
}

function matchesType(value, type) {
  switch (type) {
    case 'null': return value === null;
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && isFinite(value);
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    default: return false;
  }
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validate(value, schema, path) {
  path = path || '$';
  var errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type !== undefined) {
    var types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(function (t) { return matchesType(value, t); })) {
      errors.push({ path: path, message: 'expected ' + types.join('|') + ', got ' + typeName(value) });
      return errors;
    }
  }

  if (schema.enum !== undefined) {
    if (!schema.enum.some(function (candidate) { return sameValue(value, candidate); })) {
      errors.push({ path: path, message: 'value ' + JSON.stringify(value) + ' is not one of the allowed values' });
    }
  }

  if (schema.oneOf !== undefined) {
    var hits = schema.oneOf.filter(function (sub) {
      return validate(value, sub, path).length === 0;
    });
    if (hits.length !== 1) {
      errors.push({ path: path, message: 'expected exactly one oneOf branch to match, matched ' + hits.length });
    }
  }

  if (schema.anyOf !== undefined) {
    var anyHits = schema.anyOf.some(function (sub) {
      return validate(value, sub, path).length === 0;
    });
    if (!anyHits) errors.push({ path: path, message: 'no anyOf branch matched' });
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path: path, message: 'shorter than minLength ' + schema.minLength });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path: path, message: 'longer than maxLength ' + schema.maxLength });
    }
    if (schema.pattern !== undefined) {
      var re = new RegExp(schema.pattern);
      if (!re.test(value)) {
        errors.push({ path: path, message: 'does not match pattern ' + schema.pattern });
      }
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path: path, message: 'less than minimum ' + schema.minimum });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path: path, message: 'greater than maximum ' + schema.maximum });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path: path, message: 'fewer than minItems ' + schema.minItems });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({ path: path, message: 'more than maxItems ' + schema.maxItems });
    }
    if (schema.uniqueItems) {
      var seen = Object.create(null);
      value.forEach(function (item, i) {
        var key = JSON.stringify(item);
        if (seen[key]) errors.push({ path: path + '[' + i + ']', message: 'duplicate item' });
        seen[key] = true;
      });
    }
    if (schema.items) {
      value.forEach(function (item, i) {
        errors = errors.concat(validate(item, schema.items, path + '[' + i + ']'));
      });
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    (schema.required || []).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push({ path: path, message: 'missing required property "' + key + '"' });
      }
    });
    var props = schema.properties || {};
    Object.keys(value).forEach(function (key) {
      if (props[key]) {
        errors = errors.concat(validate(value[key], props[key], path + '.' + key));
      } else if (schema.additionalProperties === false) {
        errors.push({ path: path, message: 'unexpected property "' + key + '"' });
      }
    });
  }

  return errors;
}

module.exports = {
  validate: validate,
  typeName: typeName
};
