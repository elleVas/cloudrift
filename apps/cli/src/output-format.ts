// SPDX-License-Identifier: Apache-2.0

/** Formats every command supports. `analyze` additionally supports 'markdown' — see WASTE_OUTPUT_FORMATS. */
export const OUTPUT_FORMATS = ['table', 'json', 'csv'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const WASTE_OUTPUT_FORMATS = [...OUTPUT_FORMATS, 'markdown'] as const;
export type WasteOutputFormat = (typeof WASTE_OUTPUT_FORMATS)[number];

export function isOutputFormat<T extends string>(formats: readonly T[], format: string): format is T {
  return (formats as readonly string[]).includes(format);
}
