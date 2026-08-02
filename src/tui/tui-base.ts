/**
 * TUI Framework Base
 *
 * Provides state management and screen navigation for TUI applications.
 */

import { getStringWidth } from '../table-utils.js';
// @ts-ignore
import enquirerImport from 'enquirer';
const enquirer = enquirerImport as any;
const { prompt, Select } = enquirer;

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
    const padding = ' '.repeat(Math.max(0, width - getStringWidth(content)));

    console.log('╔═══════════════════════════════════════════════════════════════════╗');
    console.log(`║${content}${padding}║`);
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
  }

  protected async pressEnter(): Promise<void> {
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

  /**
   * A list long enough that scrolling is not a way to find anything.
   * Above this, the list is filtered before it is shown.
   */
  protected static readonly FILTER_THRESHOLD = 25;

  /**
   * Ask for a search term, and return the choices that match.
   *
   * A catalog of several hundred entries cannot be browsed by scrolling, and
   * enquirer's own type-ahead only jumps to a prefix. `actions` are always kept:
   * they are how the user leaves the screen.
   */
  protected async narrow(
    choices: any[],
    label = 'entries',
    actionNames: string[] = []
  ): Promise<any[]> {
    const isAction = (c: any) =>
      String(c.name).startsWith('__') || actionNames.includes(String(c.name));

    const actions = choices.filter(isAction);
    const items = choices.filter((c) => !isAction(c));

    if (items.length <= TuiBaseScreen.FILTER_THRESHOLD) return choices;

    const { prompt } = (await import('enquirer')).default as any;
    const { term } = await prompt({
      type: 'input',
      name: 'term',
      message: `${items.length} ${label}. Filter (blank shows all):`,
    }).catch(() => ({ term: '' }));

    const needle = String(term ?? '').trim().toLowerCase();
    if (!needle) return choices;

    const matched = items.filter((c) =>
      [c.name, c.message, c.hint].some(
        (field) => typeof field === 'string' && field.toLowerCase().includes(needle)
      )
    );

    if (matched.length === 0) {
      console.log(`\nNothing matches "${needle}".`);
      return choices;
    }

    console.log(`\n${matched.length} of ${items.length} match "${needle}".`);
    return [...matched, ...actions];
  }

  protected async select<T = string>(message: string, choices: any[]): Promise<T | null> {
    const instance = new Select({
      name: 'choice',
      message,
      choices,
      actions: {
        ctrl: { n: 'down', p: 'up' }
      }
    });

    try {
      return await instance.run() as T;
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
