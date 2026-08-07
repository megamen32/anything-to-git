'use strict';

const { A2GError } = require('./errors');

const DEFAULT_OFFSET = '+03:00';

function configuredOffset() {
  const raw = process.env.A2G_UTC_OFFSET || DEFAULT_OFFSET;
  const match = raw.match(/^([+-])(\d{2}):([0-5]\d)$/);
  if (!match) throw new A2GError(`Invalid A2G_UTC_OFFSET: ${JSON.stringify(raw)}`);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  // ISO-8601 permits offsets up to ±14:00. Reject plausible-looking typos such as +23:00.
  if (hours > 14 || (hours === 14 && minutes !== 0)) {
    throw new A2GError(`Invalid A2G_UTC_OFFSET: ${JSON.stringify(raw)} (maximum is ±14:00)`);
  }
  return raw;
}

function offsetMinutes(offset = configuredOffset()) {
  const sign = offset[0] === '-' ? -1 : 1;
  return sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function nowIso(date = new Date(), offset = configuredOffset()) {
  const shifted = new Date(date.getTime() + offsetMinutes(offset) * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `.${pad(shifted.getUTCMilliseconds(), 3)}${offset}`;
}

function filenameTimestamp(date = new Date(), offset = configuredOffset()) {
  // Keep milliseconds so two reports created in the same second never overwrite one another.
  const iso = nowIso(date, offset);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})([+-])(\d{2}):(\d{2})$/);
  if (!match) throw new A2GError(`Unable to format timestamp: ${iso}`);
  const [, year, month, day, hour, minute, second, millis, sign, offsetHour, offsetMinute] = match;
  return `${year}${month}${day}T${hour}${minute}${second}${millis}${sign === '+' ? 'p' : 'm'}${offsetHour}${offsetMinute}`;
}

module.exports = { DEFAULT_OFFSET, configuredOffset, offsetMinutes, nowIso, filenameTimestamp };
