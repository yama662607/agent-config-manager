import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/**
 * Custom MultiSelect prompt with emacs-style Ctrl+n/p navigation.
 * Extends enquirer's MultiSelect to support both arrow keys and Ctrl+n/p.
 */
// @ts-ignore - enquirer uses CommonJS exports
const MultiSelectBase = require('enquirer/lib/prompts/multiselect.js');

export class CustomMultiSelect extends MultiSelectBase {
  constructor(options: any) {
    super(options);
  }

  async dispatch(s: any, key: any): Promise<boolean> {
    // Map Ctrl+n to down, Ctrl+p to up (emacs-style)
    if (key.ctrl && key.name === 'n') {
      key.name = 'down';
      key.ctrl = false;
    } else if (key.ctrl && key.name === 'p') {
      key.name = 'up';
      key.ctrl = false;
    }
    return super.dispatch(s, key);
  }
}
