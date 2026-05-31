import { CatalogTuiScreen, McpTuiScreen, SkillTuiScreen, TuiApp } from './tui/index.js';

export async function launchCatalogTui(): Promise<void> {
  try {
    const app = new TuiApp({ currentScreen: 'catalog' });
    app.registerScreen(new CatalogTuiScreen());
    await app.run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      return;
    }
    throw error;
  }
}

export async function launchMcpTui(options: { allowHome?: boolean } = {}): Promise<void> {
  try {
    const app = new TuiApp({ currentScreen: 'mcp', allowHome: options.allowHome });
    app.registerScreen(new McpTuiScreen());
    await app.run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      return;
    }
    throw error;
  }
}

export async function launchSkillTui(options: { allowHome?: boolean } = {}): Promise<void> {
  try {
    const app = new TuiApp({ currentScreen: 'skill', allowHome: options.allowHome });
    app.registerScreen(new SkillTuiScreen());
    await app.run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      return;
    }
    throw error;
  }
}
