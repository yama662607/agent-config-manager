/**
 * TUI Framework Base
 *
 * Provides state management and screen navigation for TUI applications.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export type ScreenName = 'catalog' | 'mcp' | 'skill';

export interface TuiState {
  currentScreen: ScreenName;
  selectedItem: string | null;
  filter: string;
  target: import('../types.js').TargetName;
  lastAction: string | null;
  allowHome?: boolean;
}

export interface ScreenAction {
  type: 'navigate' | 'select' | 'filter' | 'back' | 'exit';
  payload?: any;
}

export interface TuiScreen {
  name: ScreenName;
  render(state: TuiState): Promise<TuiState | null>;
  handleAction(state: TuiState, action: ScreenAction): Promise<TuiState>;
}

/**
 * Base class for TUI screens with common utilities.
 */
export abstract class TuiBaseScreen implements TuiScreen {
  abstract name: ScreenName;

  abstract render(state: TuiState): Promise<TuiState | null>;

  async handleAction(state: TuiState, action: ScreenAction): Promise<TuiState> {
    if (action.type === 'navigate') {
      return { ...state, currentScreen: action.payload as ScreenName };
    }
    return state;
  }

  protected clear(): void {
    console.clear();
  }

  protected renderHeader(title: string, icon: string): void {
    const width = 67;
    const content = `  ${icon}  ${title}`;
    const padding = ' '.repeat(Math.max(0, width - content.length - 1));

    console.log('╔═══════════════════════════════════════════════════════════════════╗');
    console.log(`║${content}${padding}║`);
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
  }

  protected async pressEnter(): Promise<void> {
    const { prompt } = require('enquirer');
    try {
      await prompt({
        type: 'input',
        name: 'enter',
        message: 'Press Enter to continue...'
      });
    } catch {
      // Ignore
    }
  }

  protected async select<T = string>(message: string, choices: any[]): Promise<T | null> {
    const { Select } = require('enquirer');
    const prompt = new Select({
      name: 'choice',
      message,
      choices,
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      return await prompt.run() as T;
    } catch {
      return null;
    }
  }
}

/**
 * TUI Application Framework
 */
export class TuiApp {
  private screens: Map<ScreenName, TuiScreen> = new Map();
  private state: TuiState;
  private running = false;

  constructor(initialState: Partial<TuiState> = {}) {
    this.state = {
      currentScreen: 'catalog',
      selectedItem: null,
      filter: '',
      target: 'claude',
      lastAction: null,
      ...initialState
    };
  }

  registerScreen(screen: TuiScreen): void {
    this.screens.set(screen.name, screen);
  }

  async run(): Promise<void> {
    this.running = true;

    while (this.running) {
      const screen = this.screens.get(this.state.currentScreen);
      if (!screen) {
        console.error(`Screen not found: ${this.state.currentScreen}`);
        break;
      }

      try {
        const newState = await screen.render(this.state);
        if (newState) {
          this.state = newState;
        } else {
          // Screen returned null - exit
          this.running = false;
        }
      } catch (error) {
        if (error === 'EXIT') {
          this.running = false;
        } else {
          throw error;
        }
      }
    }
  }

  exit(): void {
    this.running = false;
  }

  setState(update: Partial<TuiState>): void {
    this.state = { ...this.state, ...update };
  }

  getState(): TuiState {
    return { ...this.state };
  }
}
