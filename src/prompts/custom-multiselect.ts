// @ts-ignore - enquirer uses CommonJS exports
import MultiSelectBaseImport from 'enquirer/lib/prompts/multiselect.js';
const MultiSelectBase = MultiSelectBaseImport as any;

/**
 * Custom MultiSelect prompt with emacs-style Ctrl+n/p navigation.
 * Extends enquirer's MultiSelect to support both arrow keys and Ctrl+n/p.
 */
export class CustomMultiSelect extends MultiSelectBase {
  private lastValidIndex = 0;

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
      },
      // Add help text at the bottom
      footer: 'Use ↑↓ or Ctrl+P/N to move, Space to select, Enter to confirm'
    });
  }

  /**
   * Override submit to store last valid index before clearing
   */
  submit() {
    // Store current valid index for recovery
    const currentIndex = this.state.index;
    const choices = this.choices;

    // Find nearest valid choice
    for (let i = 0; i < choices.length; i++) {
      if (!choices[i].skipped && !choices[i].disabled) {
        this.lastValidIndex = i;
        break;
      }
    }

    return super.submit();
  }

  /**
   * Override delete to handle search clearing and recover index
   */
  async delete() {
    const result = await super.delete();

    // After delete, if we have no match, recover to last valid index
    const choices = this.choices;
    let hasValidChoice = false;

    for (let i = 0; i < choices.length; i++) {
      if (!choices[i].skipped && !choices[i].disabled) {
        hasValidChoice = true;
        break;
      }
    }

    // If no valid choices (all filtered out), restore index
    if (!hasValidChoice && this.lastValidIndex >= 0) {
      this.state.index = Math.min(this.lastValidIndex, choices.length - 1);
      this.render();
    }

    return result;
  }

  /**
   * Ensure navigation stays within valid choices
   */
  protected clampIndex(value: number, max: number): number {
    const choices = this.choices;
    let validMin = 0;
    let validMax = max - 1;

    // Find first valid choice
    for (let i = 0; i < choices.length; i++) {
      if (!choices[i].skipped && !choices[i].disabled) {
        validMin = i;
        break;
      }
    }

    // Find last valid choice
    for (let i = choices.length - 1; i >= 0; i--) {
      if (!choices[i].skipped && !choices[i].disabled) {
        validMax = i;
        break;
      }
    }

    return Math.max(validMin, Math.min(value, validMax));
  }

  /**
   * Store last valid index when moving
   */
  async down() {
    const result = await super.down();

    // Update last valid index if we landed on a valid choice
    const choices = this.choices;
    const currentIndex = this.state.index;

    if (currentIndex >= 0 && currentIndex < choices.length) {
      if (!choices[currentIndex].skipped && !choices[currentIndex].disabled) {
        this.lastValidIndex = currentIndex;
      }
    }

    return result;
  }

  /**
   * Store last valid index when moving
   */
  async up() {
    const result = await super.up();

    // Update last valid index if we landed on a valid choice
    const choices = this.choices;
    const currentIndex = this.state.index;

    if (currentIndex >= 0 && currentIndex < choices.length) {
      if (!choices[currentIndex].skipped && !choices[currentIndex].disabled) {
        this.lastValidIndex = currentIndex;
      }
    }

    return result;
  }
}
