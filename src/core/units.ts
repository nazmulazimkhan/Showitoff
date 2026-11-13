/** Rhino length units → metres. Keys are the UnitSystem enum names without the prefix. */
const UNITS: Record<string, { m: number; label: string }> = {
  None: { m: 1, label: 'm' },
  Angstroms: { m: 1e-10, label: 'Å' },
  Nanometers: { m: 1e-9, label: 'nm' },
  Microns: { m: 1e-6, label: 'µm' },
  Millimeters: { m: 1e-3, label: 'mm' },
  Centimeters: { m: 1e-2, label: 'cm' },
  Decimeters: { m: 1e-1, label: 'dm' },
  Meters: { m: 1, label: 'm' },
  Dekameters: { m: 10, label: 'dam' },
  Hectometers: { m: 100, label: 'hm' },
  Kilometers: { m: 1000, label: 'km' },
  Microinches: { m: 2.54e-8, label: 'µin' },
  Mils: { m: 2.54e-5, label: 'mil' },
  Inches: { m: 0.0254, label: 'in' },
  Feet: { m: 0.3048, label: 'ft' },
  Yards: { m: 0.9144, label: 'yd' },
  Miles: { m: 1609.344, label: 'mi' },
};

/** ON::LengthUnitSystem numeric values (openNURBS). */
const BY_VALUE: Record<number, string> = {
  0: 'None',
  1: 'Microns',
  2: 'Millimeters',
  3: 'Centimeters',
  4: 'Meters',
  5: 'Kilometers',
  6: 'Microinches',
  7: 'Mils',
  8: 'Inches',
  9: 'Feet',
  10: 'Miles',
  12: 'Angstroms',
  13: 'Nanometers',
  14: 'Decimeters',
  15: 'Dekameters',
  16: 'Hectometers',
  19: 'Yards',
};

export interface UnitInfo {
  name: string;
  label: string;
  /** multiply model coordinates by this to get metres */
  toMetres: number;
}

/**
 * Accepts what rhino3dm/3DMLoader exposes for `settings.modelUnitSystem`:
 * an object `{ name: 'UnitSystem_Millimeters', value: 2 }`, a bare name, or a number.
 */
export function resolveUnits(input: unknown): UnitInfo {
  let key: string | undefined;
  if (typeof input === 'number') key = BY_VALUE[input];
  else if (typeof input === 'string') key = input;
  else if (input && typeof input === 'object') {
    const o = input as { name?: unknown; value?: unknown };
    if (typeof o.name === 'string') key = o.name;
    if ((!key || !UNITS[strip(key)]) && typeof o.value === 'number') key = BY_VALUE[o.value];
  }
  const name = key ? strip(key) : 'Meters';
  const u = UNITS[name] ?? UNITS.Meters;
  return { name: UNITS[name] ? name : 'Meters', label: u.label, toMetres: u.m };
}

function strip(s: string): string {
  return s.replace(/^UnitSystem_?/, '').replace(/^LengthUnitSystem_?/, '');
}

/** Format a length in metres for display in mm, e.g. 1250 → "1 250 mm". */
export function formatMm(metres: number): string {
  const mm = Math.round(metres * 1000);
  return `${mm.toLocaleString('en-US').replace(/,/g, ' ')} mm`;
}
