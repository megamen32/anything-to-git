'use strict';

// An envelope preserves the difference between observed null and absent fields.
// No trim, date conversion, table reconstruction, network or clock access.
module.exports = {
  normalizeFieldValue({ value }) { return { value }; },
  denormalizeFieldValue({ value }) { return value.value; },
  validateTree({ tree, fields }) {
    const issues = [];
    for (const field of fields) {
      const file = field.canonical.file;
      const id = field.canonical.pointer.slice(1);
      const envelope = tree[file]?.[id];
      if (!envelope || Array.isArray(envelope) || typeof envelope !== 'object' ||
          Object.keys(envelope).length !== 1 || !Object.hasOwn(envelope, 'value')) {
        issues.push({ level: 'error', code: 'pfki_envelope', message: `${field.capture_key} needs exactly one value property`, file });
        continue;
      }
      const value = envelope.value;
      if (value == null) continue; // Empty draft controls are valid observations.
      const type = field.site_field_type;
      const text = ['TEXTAREA', 'INPUT', 'PHONE', 'EMAIL'];
      const numeric = ['DATE', 'DOUBLE', 'MONEY', 'SINGLESELECT'];
      const table = ['MULTISELECT', 'TEAM_MEMBER', 'CALENDAR_PLAN_ITEM', 'BUDGET_LINE',
        'OTHER_MEDIA_METRICS', 'MARKETING_SUPPORT_UNIT', 'CONTENT_DISTRIBUTION_CHANEL',
        'CONTENT_TARGET_GROUP', 'CULTURAL_LEADER', 'SIGNATURE_PROCESS'];
      const valid = text.includes(type) ? typeof value === 'string' ||
        (field.site_allow_multiple && Array.isArray(value) && value.every((item) => typeof item === 'string')) :
        numeric.includes(type) ? typeof value === 'number' && Number.isFinite(value) :
        table.includes(type) ? Array.isArray(value) :
        type === 'FILE' ? Array.isArray(value) || (Number.isInteger(value) && value >= 0) :
        type === 'LINK' ? typeof value === 'string' || Array.isArray(value) : false;
      if (!valid) issues.push({ level: 'error', code: 'pfki_site_type', message: `${field.capture_key} has an invalid ${type} value`, file });
      if (typeof value === 'string' && field.site_max_length > 0 && value.length > field.site_max_length) {
        issues.push({ level: 'error', code: 'pfki_max_length', message: `${field.capture_key} exceeds the portal maximum length`, file });
      }
    }
    return issues;
  },
};
