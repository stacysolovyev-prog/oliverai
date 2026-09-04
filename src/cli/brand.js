/**
 * OllyAI branding: the mark, the wordmark, and the startup banner.
 *
 * The palette is deliberately green-on-black. Colors are emitted as 256-color
 * codes with a 16-color fallback so the logo still reads on a basic terminal.
 */

import { useColor, stripAnsi, termWidth, c } from '../util/ui.js';

const ESC = '\x1b';
const rich = useColor && !/^(dumb|vt100)$/.test(process.env.TERM || '');

/** 256-color foreground, falling back to plain green when unsupported. */
const fg = (n) => (s) => {
  if (!useColor) return String(s);
  if (!rich) return `${ESC}[32m${s}${ESC}[39m`;
  return `${ESC}[38;5;${n}m${s}${ESC}[39m`;
};

/** The OllyAI green ramp, dark to bright. */
export const green = {
  deepest: fg(22),
  deep: fg(28),
  mid: fg(34),
  bright: fg(40),
  neon: fg(46),
  pale: fg(120),
};

export const theme = {
  accent: green.neon,
  accentDim: green.mid,
  label: green.deep,
  text: (s) => c.white(s),
  muted: (s) => c.gray(s),
  warn: (s) => c.yellow(s),
  error: (s) => c.red(s),
};

/** The compact mark used in prompts and tool lines. */
export const MARK = '\u2b22'; // ⬢

/**
 * Full ASCII wordmark, shaded across the green ramp so it reads as a single
 * object rather than five separate lines.
 */
export function logo() {
  const rows = [
    '  ___   _  _         _   ___ ',
    ' / _ \\ | || | _  _  /_\\ |_ _|',
    '| (_) || || || || |/ _ \\ | | ',
    ' \\___/ |_||_| \\_, /_/ \\_\\___|',
    '              |__/           ',
  ];
  const ramp = [green.deep, green.mid, green.bright, green.neon, green.bright];
  return rows.map((r, i) => ramp[i % ramp.length](r)).join('\n');
}

/** A denser block-art wordmark for wide terminals. */
export function logoBig() {
  const rows = [
    '  ██████╗ ██╗     ██╗  ██╗   ██╗ █████╗ ██╗',
    ' ██╔═══██╗██║     ██║  ╚██╗ ██╔╝██╔══██╗██║',
    ' ██║   ██║██║     ██║   ╚████╔╝ ███████║██║',
    ' ██║   ██║██║     ██║    ╚██╔╝  ██╔══██║██║',
    ' ╚██████╔╝███████╗███████╗██║   ██║  ██║██║',
    '  ╚═════╝ ╚══════╝╚══════╝╚═╝   ╚═╝  ╚═╝╚═╝',
  ];
  const ramp = [green.deepest, green.deep, green.mid, green.bright, green.neon, green.bright];
  return rows.map((r, i) => ramp[i](r)).join('\n');
}

/** A green-bordered box, matching the logo palette. */
export function greenBox(lines, { title = '' } = {}) {
  const w = Math.min(termWidth(), 78) - 2;
  const b = green.deep;
  const out = [];
  const head = title ? `\u256d\u2500 ${title} ` : '\u256d';
  out.push(b(head + '\u2500'.repeat(Math.max(0, w + 1 - stripAnsi(head).length)) + '\u256e'));
  for (const line of lines) {
    const pad = Math.max(0, w - stripAnsi(line).length - 1);
    out.push(b('\u2502 ') + line + ' '.repeat(pad) + b('\u2502'));
  }
  out.push(b('\u2570' + '\u2500'.repeat(w) + '\u256f'));
  return out.join('\n');
}

/**
 * The startup banner.
 * @param {{brain?:string, providers?:number, models?:number, cwd?:string, repo?:string, approval?:string}} info
 */
export function banner(info = {}) {
  const wide = termWidth() >= 62;
  const art = wide ? logoBig() : logo();
  const row = (k, v) => `${green.deep(k.padEnd(9))}${c.white(v)}`;

  const lines = [];
  lines.push(`${green.neon(MARK)}  ${c.bold(green.neon('OllyAI'))} ${c.gray('\u00b7 a coding agent that runs on free models')}`);
  lines.push('');
  if (info.brain) lines.push(row('brain', info.brain));
  if (info.models != null) {
    lines.push(row('route', `OmniRoute \u00b7 ${info.models} models across ${info.providers} provider${info.providers === 1 ? '' : 's'}`));
  }
  if (info.repo) lines.push(row('repo', info.repo));
  if (info.cwd) lines.push(row('cwd', info.cwd));
  if (info.approval) lines.push(row('mode', info.approval));
  lines.push('');
  lines.push(c.gray(`${green.mid('/help')} for commands   ${green.mid('/key')} to add any API key   ${green.mid('/model')} to pin a model`));

  return `\n${art}\n\n${greenBox(lines)}\n`;
}

/** The input prompt, e.g. "⬢ › ". */
export function prompt() {
  return `${green.neon(MARK)} ${green.deep('\u203a')} `;
}

/** Marker printed before each tool invocation, Claude-Code style. */
export function toolMark(name) {
  return `${green.mid('\u23fa')} ${c.bold(name)}`;
}
