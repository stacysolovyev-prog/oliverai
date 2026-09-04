/** Terminal rendering helpers: colors, spinners, boxes, markdown-ish output. */

const ESC = '\x1b';
const FORCE = process.env.OLLYAI_COLOR === '1';
const NO = process.env.NO_COLOR !== undefined || process.env.OLLYAI_COLOR === '0';
export const useColor = FORCE || (!NO && process.stdout.isTTY === true);

const wrap = (open, close) => (s) =>
  (useColor ? `${ESC}[${open}m${s}${ESC}[${close}m` : String(s));

export const c = {
  reset: `${ESC}[0m`,
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  white: wrap(97, 39),
};

/** OllyAI accent color - used for the prompt and brand marks. */
export const accent = (s) => c.cyan(s);

export const sym = {
  ok: c.green('✔'),
  err: c.red('✘'),
  warn: c.yellow('▲'),
  info: c.blue('ℹ'),
  arrow: c.gray('›'),
  bullet: c.gray('•'),
  tool: c.magenta('⏺'),
};

export function termWidth() {
  return Math.max(40, Math.min(process.stdout.columns || 100, 120));
}

/** Strip ANSI so we can measure real display width. */
export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
}

export function truncate(s, n) {
  const plain = stripAnsi(s);
  if (plain.length <= n) return s;
  return plain.slice(0, Math.max(0, n - 1)) + '…';
}

/** Indent every line of a block. */
export function indent(text, pad = '  ') {
  return String(text).split('\n').map((l) => pad + l).join('\n');
}

export function hr(char = '─') {
  return c.gray(char.repeat(termWidth()));
}

/** A titled box, used for banners and summaries. */
export function box(title, lines) {
  const w = termWidth() - 2;
  const body = Array.isArray(lines) ? lines : String(lines).split('\n');
  const out = [];
  const t = title ? ` ${title} ` : '';
  const left = '╭─' + t;
  out.push(c.gray(left + '─'.repeat(Math.max(0, w + 1 - stripAnsi(left).length)) + '╮'));
  for (const line of body) {
    const pad = Math.max(0, w - stripAnsi(line).length - 1);
    out.push(c.gray('│ ') + line + ' '.repeat(pad) + c.gray('│'));
  }
  out.push(c.gray('╰' + '─'.repeat(w) + '╯'));
  return out.join('\n');
}

/** A minimal spinner that no-ops when not attached to a TTY. */
export function spinner(text) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let timer = null;
  let current = text;
  const tty = process.stdout.isTTY === true && !process.env.OLLYAI_NO_SPINNER;
  const clearLine = `\r${ESC}[2K`;

  const render = () => {
    if (!tty) return;
    process.stdout.write(`${clearLine}${c.cyan(frames[i++ % frames.length])} ${c.gray(current)}`);
  };

  return {
    start() { if (tty && !timer) { render(); timer = setInterval(render, 80); } return this; },
    update(t) { current = t; return this; },
    stop(finalLine) {
      if (timer) { clearInterval(timer); timer = null; }
      if (tty) process.stdout.write(clearLine);
      if (finalLine) console.log(finalLine);
      return this;
    },
  };
}

/**
 * Very small markdown renderer for assistant output: headings, bold, inline
 * code, bullets and fenced code blocks. Deliberately not a full parser - it
 * only needs to make model output pleasant to read in a terminal.
 */
export function renderMarkdown(md) {
  const lines = String(md).split('\n');
  const out = [];
  let inFence = false;

  for (const line of lines) {
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      if (!inFence) { inFence = true; out.push(c.gray(`  ┌─ ${fence[1] || 'code'}`)); }
      else { inFence = false; out.push(c.gray('  └─')); }
      continue;
    }
    if (inFence) { out.push(c.gray('  │ ') + c.yellow(line)); continue; }

    let s = line;
    s = s.replace(/^(#{1,6})\s+(.*)$/, (_m, _h, t) => c.bold(c.cyan(t)));
    s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t) => c.bold(t));
    s = s.replace(/`([^`]+)`/g, (_m, t) => c.yellow(t));
    s = s.replace(/^(\s*)[-*]\s+/, (_m, sp) => `${sp}${c.gray('•')} `);
    out.push(s);
  }
  return out.join('\n');
}

/** Human-readable byte count. */
export function bytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** Human-readable duration. */
export function ms(n) {
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60000)}m${Math.round((n % 60000) / 1000)}s`;
}
