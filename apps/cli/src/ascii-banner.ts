import chalk from 'chalk';

const BANNER_LINES = [
  ' $$$$$$\\  $$\\                           $$\\ $$$$$$$\\  $$\\  $$$$$$\\    $$\\     ',
  '$$  __$$\\ $$ |                          $$ |$$  __$$\\ \\__|$$  __$$\\   $$ |    ',
  '$$ /  \\__|$$ | $$$$$$\\  $$\\   $$\\  $$$$$$$ |$$ |  $$ |$$\\ $$ /  \\__|$$$$$$\\   ',
  '$$ |      $$ |$$  __$$\\ $$ |  $$ |$$  __$$ |$$$$$$$  |$$ |$$$$\\     \\_$$  _|  ',
  '$$ |      $$ |$$ /  $$ |$$ |  $$ |$$ /  $$ |$$  __$$< $$ |$$  _|      $$ |    ',
  '$$ |  $$\\ $$ |$$ |  $$ |$$ |  $$ |$$ |  $$ |$$ |  $$ |$$ |$$ |        $$ |$$\\ ',
  '\\$$$$$$  |$$ |\\$$$$$$  |\\$$$$$$  |\\$$$$$$$ |$$ |  $$ |$$ |$$ |        \\$$$$  |',
  ' \\______/ \\__| \\______/  \\______/  \\_______|\\__|  \\__|\\__|\\__|         \\____/',
];

// Ayu Dark's "normal" palette (its muted tones, not the "bright" set) — the
// same colors the theme uses for its own neofetch-style logo, cycled per line
// for a soft rainbow instead of the harsher pure-ANSI rainbow colors.
const AYU_RAINBOW = [
  '#EA6C73', // red
  '#F9AF4F', // orange/yellow
  '#7FD962', // green
  '#90E1C6', // cyan
  '#53BDFA', // blue
  '#CDA1FA', // magenta/purple
];

export function renderBanner(): string {
  return BANNER_LINES.map((line, i) => chalk.hex(AYU_RAINBOW[i % AYU_RAINBOW.length])(line)).join('\n');
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
