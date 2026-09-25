/*
 * Machine presets and unit handling.
 *
 * Wavelength and eyewear are recorded per machine on purpose: a shop running
 * both a 1064nm fiber and a 450nm diode needs two different pairs of glasses,
 * and neither pair protects against the other machine.
 */

export const MACHINE_PRESETS = [
  {
    id: 'atomstack-x40-max',
    label: 'AtomStack X40 Max',
    values: {
      name: 'AtomStack X40 Max',
      kind: 'diode', source_type: 'diode', role: 'mixed',
      power_w: 40, wavelength_nm: 450,
      bed_w_mm: 800, bed_h_mm: 400,
      max_speed: 36000,                    // 600 mm/s, expressed in GRBL's mm/min
      controller: 'GRBL (32-bit)', speed_unit: 'mm/min',
      spot_size_mm: '0.1 × 0.1',
      has_gas_assist: 0, color: '#7c5cff',
      eyewear_od: 'OD5+ @ 450nm',
      eyewear_note: 'Blue-diode glasses only. Your 1064nm fiber eyewear does NOT protect against this machine.',
      notes: '40W optical from 8 × 6W diode couplings, 210W input class. '
           + 'F30 Plus air assist, tool-free focus. Single pass: ~18mm basswood, '
           + '9mm MDF, 0.1mm stainless.',
    },
  },
  {
    id: 'debin-dbf-100-mopa',
    label: 'DeBin DBF-100 MOPA (100W)',
    values: {
      name: 'DeBin DBF-100 MOPA',
      kind: 'fiber', source_type: 'mopa', role: 'marking',
      power_w: 100, wavelength_nm: 1064, speed_unit: 'mm/s',
      max_speed: 7000,
      source_brand: 'JPT / Raycus',
      freq_min_khz: 1, freq_max_khz: 4000,
      lens_mm: '75, 150, 300',
      spot_size_mm: 'M² ≤ 1.5, min line 0.01',
      has_gas_assist: 0, color: '#f59e0b',
      eyewear_od: 'OD5+ @ 1064nm',
      eyewear_note: '1064nm IR glasses only. The beam is INVISIBLE — you get no blink reflex. '
                  + 'Blue-diode eyewear does nothing here.',
      notes: 'Marking / annealing / deep engraving galvo. MOPA pulse width control is what '
           + 'makes colour marking on stainless possible. Confirm your source\'s available '
           + 'pulse widths in its manual — they are a fixed list, not a free range.',
    },
  },
  {
    id: 'fiber-marker',
    label: 'Fiber marker (generic galvo)',
    values: {
      name: 'Fiber marker', kind: 'fiber', source_type: 'mopa', role: 'marking',
      wavelength_nm: 1064, speed_unit: 'mm/s', has_gas_assist: 0,
      eyewear_od: 'OD5+ @ 1064nm',
      eyewear_note: '1064nm IR glasses. The beam is invisible.',
    },
  },
  {
    id: 'co2',
    label: 'CO2 (generic)',
    values: {
      name: 'CO2 laser', kind: 'co2', source_type: 'cw', role: 'mixed',
      wavelength_nm: 10600, speed_unit: 'mm/s', has_gas_assist: 1,
      eyewear_od: 'OD5+ @ 10600nm',
      eyewear_note: 'CO2 wavelength. Most polycarbonate shields block it, but use rated eyewear.',
    },
  },
];

export const MACHINE_ROLES = [
  { value: 'cutting', label: 'Cutting' },
  { value: 'marking', label: 'Marking / engraving (galvo)' },
  { value: 'engraving', label: 'Engraving (gantry)' },
  { value: 'mixed', label: 'Mixed' },
];

export const SOURCE_TYPES = [
  { value: 'diode', label: 'Diode' },
  { value: 'mopa', label: 'MOPA fiber' },
  { value: 'cw', label: 'CW fiber / CO2' },
  { value: 'q-switch', label: 'Q-switched fiber' },
];

export const ASSIST_GASES = [
  { value: 'none', label: 'None' },
  { value: 'air', label: 'Air' },
  { value: 'nitrogen', label: 'Nitrogen' },
  { value: 'oxygen', label: 'Oxygen' },
  { value: 'argon', label: 'Argon' },
];

export const DROSS = [
  { value: 'none', label: 'None — clean edge' },
  { value: 'light', label: 'Light — wipes off' },
  { value: 'heavy', label: 'Heavy — needs grinding' },
];

/* ------------------------------------------------------------- units */

const TO_MM_MIN = { 'mm/min': 1, 'mm/s': 60, 'in/min': 25.4, 'in/s': 25.4 * 60 };

export function toMmPerMin(speed, unit) {
  const n = Number(speed);
  if (!Number.isFinite(n)) return null;
  const f = TO_MM_MIN[unit || 'mm/min'];
  return f === undefined ? null : n * f;
}

export function fromMmPerMin(mmMin, unit) {
  const n = Number(mmMin);
  if (!Number.isFinite(n)) return null;
  const f = TO_MM_MIN[unit || 'mm/min'];
  return f === undefined ? null : n / f;
}

/**
 * Render a speed, and show the other unit alongside when it helps.
 * 7 mm/s and 420 mm/min are the same number; without this they look like
 * wildly different settings sitting next to each other.
 */
export function speedLabel(speed, unit, { withAlt = true } = {}) {
  if (speed === null || speed === undefined || speed === '') return '—';
  const u = unit || 'mm/min';
  const main = `${round(speed)} ${u}`;
  if (!withAlt || !(u in TO_MM_MIN)) return main;
  const mmMin = toMmPerMin(speed, u);
  const alt = u === 'mm/min' ? `${round(mmMin / 60)} mm/s` : `${round(mmMin)} mm/min`;
  return `${main} (${alt})`;
}

const round = (n) => String(Number(Number(n).toFixed(2)));

/**
 * Which parameter groups a machine actually needs shown.
 *
 * A 100W MOPA marker and a 40W diode gantry share almost no parameters. Gas
 * assist, nozzle standoff and pierce timing belong to kilowatt-class metal
 * CUTTING machines — showing them on a marking galvo is noise, so they only
 * appear when a machine is actually set up for cutting with assist gas.
 */
/** Focal lengths on the bench. Used when a machine has none recorded. */
export const LENSES = [75, 150, 300];

export function fieldGroupsFor(machine) {
  const kind = machine?.kind || 'diode';
  const role = machine?.role || 'mixed';
  const isFiber = kind === 'fiber' || kind === 'uv';
  const isGalvo = isFiber && role !== 'cutting';
  return {
    basic: true,
    raster: role !== 'cutting',
    // Only for machines genuinely plumbed for cutting gas, never by default.
    gas: Boolean(machine?.has_gas_assist) && (role === 'cutting' || role === 'mixed'),
    pierce: Boolean(machine?.has_gas_assist) && role === 'cutting' && (isFiber || kind === 'co2'),
    pulse: isFiber,
    galvo: isGalvo,
    // MOPA pulse-width control is what produces colour on stainless.
    colour: isGalvo && (machine?.source_type === 'mopa'),
    quality: true,
  };
}

/**
 * Common MOPA colour-marking starting points on stainless.
 * These are directions to explore, not settings to trust — colour depends on
 * your source, lens, alloy and surface finish. Always test on scrap.
 */
export const MOPA_COLOUR_HINTS = [
  { name: 'Black (anneal)', hint: 'Low speed, low-ish power, long pulse, tight hatch' },
  { name: 'Brown / bronze', hint: 'Raise speed slightly from the black recipe' },
  { name: 'Gold / amber', hint: 'Higher frequency, shorter pulse than brown' },
  { name: 'Rainbow / magenta', hint: 'Narrow band — small frequency changes swing the colour' },
  { name: 'Blue', hint: 'Usually higher frequency and faster than gold' },
  { name: 'Green', hint: 'The fussiest — very sensitive to focus and surface prep' },
];
