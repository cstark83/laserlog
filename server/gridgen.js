/**
 * LaserLog — test grid file generator.
 *
 * Turns a grid you've defined in the app into a file you can actually run.
 *
 * The output is a .lbrn LightBurn project with ONE LAYER PER CELL, each layer
 * already carrying its own speed / power / frequency / pulse width and named
 * with those values. You open it, frame it, and hit start — there is no
 * transcribing a legend into thirty layers by hand, which is the part of
 * material testing everybody gets wrong.
 *
 * LightBurn has 30 cut layers (C00–C29), so a grid is capped at 30 cells.
 *
 * Cell indices are engraved next to each square using a small built-in stroke
 * font, so the burnt piece is readable on its own without the app next to it.
 */

/* ------------------------------------------------------------ geometry */

/** Value at step i along an axis, inclusive of both ends. */
export function stepValue(min, max, steps, i) {
  const lo = Number(min), hi = Number(max), n = Number(steps);
  if (!Number.isFinite(lo)) return null;
  if (n <= 1) return lo;
  return Number((lo + ((hi - lo) / (n - 1)) * i).toFixed(4));
}

/* --------------------------------------------------- tiny stroke font */

/*
 * Digits and a few symbols as polylines on a 0..1 box. Hand-rolled because
 * embedding a real font would mean shipping a font and doing text layout;
 * these only ever have to render single digits and a decimal point.
 */
const GLYPHS = {
  '0': [[[0,0],[1,0],[1,2],[0,2],[0,0]]],
  '1': [[[0.3,1.6],[0.6,2],[0.6,0]], [[0.15,0],[1,0]]],
  '2': [[[0,1.7],[0.3,2],[0.8,2],[1,1.6],[0,0],[1,0]]],
  '3': [[[0,2],[1,2],[0.45,1.15],[1,0.7],[0.8,0.05],[0.2,0],[0,0.3]]],
  '4': [[[0.75,0],[0.75,2],[0,0.6],[1,0.6]]],
  '5': [[[1,2],[0,2],[0,1.15],[0.7,1.2],[1,0.85],[0.8,0.05],[0.1,0.05]]],
  '6': [[[0.95,1.9],[0.35,2],[0,1.3],[0,0.35],[0.4,0],[0.85,0.15],[1,0.65],[0.6,1],[0.1,0.9]]],
  '7': [[[0,2],[1,2],[0.35,0]]],
  '8': [[[0.35,1.05],[0.05,1.45],[0.25,1.95],[0.75,1.95],[0.95,1.45],[0.6,1.05],[0.1,0.7],[0.2,0.05],[0.8,0.05],[0.9,0.7],[0.35,1.05]]],
  '9': [[[0.05,0.1],[0.6,0],[1,0.65],[1,1.6],[0.6,2],[0.15,1.85],[0,1.3],[0.45,1],[0.95,1.15]]],
  '.': [[[0.35,0],[0.55,0],[0.55,0.2],[0.35,0.2],[0.35,0]]],
  '-': [[[0.1,1],[0.9,1]]],
  'x': [[[0,0],[0.9,0.9]], [[0.9,0],[0,0.9]]],
};

/**
 * Lay a short string out as polylines.
 * Returns arrays of [x,y] points in mm, origin bottom-left of the text.
 */
function textPolylines(str, x, y, size) {
  const out = [];
  const unit = size / 2;            // glyphs are 2 units tall
  const advance = unit * 1.35;
  let cx = x;
  for (const ch of String(str)) {
    const g = GLYPHS[ch];
    if (g) {
      for (const poly of g) {
        out.push(poly.map(([px, py]) => [cx + px * unit, y + py * unit]));
      }
    }
    cx += advance;
  }
  return out;
}

/* ----------------------------------------------------------- .lbrn out */

// Newlines must be entity-encoded inside an attribute value — a raw newline
// there is normalised to a space by any conforming XML parser, which would
// flatten the notes block into one long line.
const xa = (v) => String(v ?? '')
  .replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('\r\n', '&#10;').replaceAll('\n', '&#10;').replaceAll('\r', '&#10;');

/** Which entry parameter an axis drives. */
const AXIS_PARAM = {
  speed: 'speed',
  power: 'maxPower',
  passes: 'numPasses',
  interval: 'interval',
  focus: 'zOffset',
  dpi: 'DPI',
  frequency: 'frequency',      // kHz in the app, Hz in the file
  pulse_width: 'QPulseWidth',
};

const AXIS_SHORT = {
  speed: 'S', power: 'P', passes: 'N', interval: 'I',
  focus: 'Z', dpi: 'D', frequency: 'F', pulse_width: 'W',
};

/**
 * Build the CutSetting parameter bag for one cell.
 * Fixed parameters come first, then the two axes overwrite them.
 */
function cellParams(test, fixed, xVal, yVal) {
  const p = {};

  // Held-constant values recorded with the grid.
  if (fixed.passes != null) p.numPasses = fixed.passes;
  if (fixed.line_interval_mm != null) p.interval = fixed.line_interval_mm;
  if (fixed.focus_offset_mm != null) p.zOffset = fixed.focus_offset_mm;
  if (fixed.speed != null) p.speed = fixed.speed;
  if (fixed.power_max != null) p.maxPower = fixed.power_max;
  if (fixed.frequency_khz != null) p.frequency = Math.round(fixed.frequency_khz * 1000);
  if (fixed.pulse_width_ns != null) p.QPulseWidth = fixed.pulse_width_ns;
  p.runBlower = fixed.air_assist ? 1 : 0;

  const apply = (axis, value) => {
    const key = AXIS_PARAM[axis];
    if (!key || value === null) return;
    p[key] = key === 'frequency' ? Math.round(value * 1000) : value;
  };
  apply(test.x_axis, xVal);
  apply(test.y_axis, yVal);

  // LightBurn wants a floor for ramped power; mirror max unless told otherwise.
  if (p.maxPower != null && p.minPower == null) p.minPower = p.maxPower;
  return p;
}

const labelFor = (test, xVal, yVal) => {
  const bits = [];
  if (AXIS_SHORT[test.x_axis]) bits.push(`${AXIS_SHORT[test.x_axis]}${trim(xVal)}`);
  if (AXIS_SHORT[test.y_axis]) bits.push(`${AXIS_SHORT[test.y_axis]}${trim(yVal)}`);
  return bits.join(' ');
};

const trim = (n) => (n === null || n === undefined ? '' : String(Number(Number(n).toFixed(3))));

/**
 * Generate the LightBurn project.
 *
 * opts: { cell = 10, gap = 3, label = true, labelSize = 3 } — all mm.
 */
export function buildLbrn(test, opts = {}) {
  const cell = Number(opts.cell ?? 10);
  const gap = Number(opts.gap ?? 3);
  const label = opts.label !== false;
  const labelSize = Number(opts.labelSize ?? 3);

  const cols = Math.max(1, Number(test.x_steps) || 1);
  const rows = Math.max(1, Number(test.y_steps) || 1);
  // LightBurn has exactly 30 cut layers, C00–C29. With labels switched on the
  // legend takes one of them, so the grid itself can only have 29 cells.
  const total = cols * rows;
  const maxCells = label ? 29 : 30;
  if (total > maxCells) {
    const err = new Error(`grid_too_large:${total}:${maxCells}`);
    err.cells = total;
    err.max = maxCells;
    err.labelled = label;
    throw err;
  }

  const fixed = test.fixed_json ? JSON.parse(test.fixed_json) : {};
  const pitch = cell + gap;
  const labelGutter = label ? labelSize * 2.2 : 0;

  const cutSettings = [];
  const shapes = [];
  let index = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const xVal = stepValue(test.x_min, test.x_max, cols, c);
      const yVal = stepValue(test.y_min, test.y_max, rows, r);
      const p = cellParams(test, fixed, xVal, yVal);

      // Row 0 sits at the bottom so the sheet reads like the on-screen grid.
      const x0 = labelGutter + c * pitch;
      const y0 = labelGutter + r * pitch;

      const type = (test.operation === 'cut' || test.operation === 'score') ? 'Cut' : 'Scan';
      const kv = Object.entries(p)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `        <${k} Value="${xa(v)}"/>`)
        .join('\n');

      cutSettings.push(
        `    <CutSetting type="${type}">\n` +
        `        <index Value="${index}"/>\n` +
        `        <name Value="${xa(labelFor(test, xVal, yVal))}"/>\n` +
        `        <priority Value="${index}"/>\n` +
        `${kv}\n` +
        `        <doOutput Value="1"/>\n` +
        `    </CutSetting>`
      );

      // A filled square is the test patch. Rect is W/H around its own centre.
      shapes.push(
        `    <Shape Type="Rect" CutIndex="${index}" W="${cell}" H="${cell}" Cr="0">\n` +
        `        <XForm>1 0 0 1 ${round(x0 + cell / 2)} ${round(y0 + cell / 2)}</XForm>\n` +
        `    </Shape>`
      );
      index++;
    }
  }

  // Axis numbering, engraved on its own layer so it can be run or skipped.
  if (label) {
    const labelIndex = index;
    cutSettings.push(
      `    <CutSetting type="Scan">\n` +
      `        <index Value="${labelIndex}"/>\n` +
      `        <name Value="LABELS"/>\n` +
      `        <priority Value="${labelIndex}"/>\n` +
      `        <maxPower Value="${fixed.power_max ?? 20}"/>\n` +
      `        <minPower Value="${fixed.power_max ?? 20}"/>\n` +
      `        <speed Value="${fixed.speed ?? 500}"/>\n` +
      `        <doOutput Value="1"/>\n` +
      `    </CutSetting>`
    );

    const polys = [];
    for (let c = 0; c < cols; c++) {
      const v = stepValue(test.x_min, test.x_max, cols, c);
      polys.push(...textPolylines(trim(v), labelGutter + c * pitch, labelGutter - labelSize * 1.6, labelSize));
    }
    for (let r = 0; r < rows; r++) {
      const v = stepValue(test.y_min, test.y_max, rows, r);
      polys.push(...textPolylines(trim(v), 0.5, labelGutter + r * pitch + cell / 2 - labelSize / 2, labelSize));
    }

    for (const poly of polys) {
      shapes.push(polylineShape(poly, labelIndex));
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<LightBurnProject AppVersion="1.7.00" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">',
    `    <Notes ShowOnLoad="1" Notes="${xa(notesFor(test, cell, gap))}"/>`,
    ...cutSettings,
    ...shapes,
    '</LightBurnProject>',
  ].join('\n');
}

/**
 * A LightBurn Path shape from a list of [x,y] points.
 *
 * Vertices carry both bezier control handles explicitly at zero offset, which
 * is the straight-line case. The rectangles are the part of this file that
 * matters and they use the well-documented Rect shape; if a LightBurn version
 * reads these label paths differently, turn labels off and the grid still runs.
 */
function polylineShape(points, cutIndex) {
  const verts = points
    .map(([x, y]) => `V${round(x)} ${round(y)}c0x0c0y0c1x0c1y0`).join('');
  const prims = points.slice(1).map((_, i) => `L${i} ${i + 1}`).join('');
  return `    <Shape Type="Path" CutIndex="${cutIndex}">\n` +
         `        <XForm>1 0 0 1 0 0</XForm>\n` +
         `        <VertList>${verts}</VertList>\n` +
         `        <PrimList>${prims}</PrimList>\n` +
         `    </Shape>`;
}

const round = (n) => Number(Number(n).toFixed(3));

function notesFor(test, cell, gap) {
  const L = [
    `${test.name}`,
    `Grid ${test.x_steps} × ${test.y_steps}, ${cell}mm squares, ${gap}mm gap.`,
    `Across (left to right): ${test.x_axis} ${test.x_min} → ${test.x_max}`,
    `Up (bottom to top): ${test.y_axis} ${test.y_min} → ${test.y_max}`,
    '',
    'Each square is its own layer, already set. Check the cut list before running.',
    'Generated by LaserLog.',
  ];
  if (test.lens_mm) L.splice(1, 0, `Lens: ${test.lens_mm}mm`);
  if (test.rotary) L.splice(1, 0, 'ROTARY setup');
  return L.join('\n');
}

/* ------------------------------------------------------------ SVG out */

/**
 * SVG fallback. Each cell gets a distinct stroke colour so LightBurn maps it
 * to its own layer on import — but the parameters are NOT carried, so you set
 * them yourself. The .lbrn is the better output; this exists for other software.
 */
export function buildSvg(test, opts = {}) {
  const cell = Number(opts.cell ?? 10);
  const gap = Number(opts.gap ?? 3);
  const labelSize = Number(opts.labelSize ?? 3);
  const cols = Math.max(1, Number(test.x_steps) || 1);
  const rows = Math.max(1, Number(test.y_steps) || 1);
  const pitch = cell + gap;
  const gutter = labelSize * 2.2;

  const w = gutter + cols * pitch + gap;
  const h = gutter + rows * pitch + gap;

  // LightBurn's first layer colours, in order.
  const PALETTE = ['#000000', '#0000ff', '#ff0000', '#00e000', '#d0d000', '#ff8000',
                   '#00e0e0', '#ff00ff', '#b4b4b4', '#0000a0', '#a00000', '#00a000',
                   '#a0a000', '#c08000', '#00a0ff', '#a000a0', '#808080', '#7d87b9',
                   '#bb7784', '#4a6fe3', '#d33f6a', '#8cd78c', '#f0b98d', '#f6c4e1',
                   '#fa9ed4', '#500a78', '#b45a00', '#004754', '#86fa88', '#ffdb66'];

  const parts = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = gutter + c * pitch;
      const y = h - gutter - r * pitch - cell;      // SVG y grows downward
      parts.push(
        `  <rect x="${round(x)}" y="${round(y)}" width="${cell}" height="${cell}" ` +
        `fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="0.1"/>`
      );
      i++;
    }
  }

  for (let c = 0; c < cols; c++) {
    const v = stepValue(test.x_min, test.x_max, cols, c);
    parts.push(`  <text x="${round(gutter + c * pitch)}" y="${round(h - gutter + labelSize * 1.4)}" ` +
               `font-size="${labelSize}" fill="#000">${xa(trim(v))}</text>`);
  }
  for (let r = 0; r < rows; r++) {
    const v = stepValue(test.y_min, test.y_max, rows, r);
    parts.push(`  <text x="0.5" y="${round(h - gutter - r * pitch - cell / 2 + labelSize / 2)}" ` +
               `font-size="${labelSize}" fill="#000">${xa(trim(v))}</text>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${round(w)}mm" height="${round(h)}mm"
     viewBox="0 0 ${round(w)} ${round(h)}">
  <title>${xa(test.name)}</title>
${parts.join('\n')}
</svg>`;
}

/** The legend, for printing or reading on the phone next to the machine. */
export function buildLegend(test) {
  const cols = Math.max(1, Number(test.x_steps) || 1);
  const rows = Math.max(1, Number(test.y_steps) || 1);
  const fixed = test.fixed_json ? JSON.parse(test.fixed_json) : {};
  const cells = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        layer: `C${String(i).padStart(2, '0')}`,
        col: c, row: r,
        x_value: stepValue(test.x_min, test.x_max, cols, c),
        y_value: stepValue(test.y_min, test.y_max, rows, r),
        params: cellParams(test, fixed, stepValue(test.x_min, test.x_max, cols, c),
                           stepValue(test.y_min, test.y_max, rows, r)),
      });
      i++;
    }
  }
  return { name: test.name, x_axis: test.x_axis, y_axis: test.y_axis, cells };
}
