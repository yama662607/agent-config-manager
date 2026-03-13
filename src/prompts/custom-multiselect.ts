import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// @ts-ignore - enquirer uses CommonJS exports
const MultiSelectBase = require('enquirer/lib/prompts/multiselect.js');

/**
 * Custom MultiSelect prompt with emacs-style Ctrl+n/p navigation.
 * Extends enquirer's MultiSelect to support both arrow keys and Ctrl+n/p.
 */
export class CustomMultiSelect extends MultiSelectBase {
  constructor(options: any) {
    // Override key actions: Ctrl+n → down, Ctrl+p → up (emacs-style)
    const customActions = {
      ctrl: {
        ...options.actions?.ctrl,
        n: 'down',  // Override 'newItem'
        p: 'up'     // Override 'search'
      }
    };

    super({
      ...options,
      actions: {
        ...options.actions,
        ...customActions
      }
    });
  }
}
