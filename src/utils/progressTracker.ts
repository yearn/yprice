import { EventEmitter } from 'events';
import { logger } from './logger';

interface ProgressState {
  phase: string;
  chainId?: number;
  current: number;
  total: number;
  details?: string;
  startTime: number;
  errors: number;
}

export class ProgressTracker extends EventEmitter {
  private states: Map<string, ProgressState> = new Map();
  private displayInterval: NodeJS.Timeout | null = null;
  private lastDisplayTime = 0;
  private readonly MIN_DISPLAY_INTERVAL = 2000; // Update display every 2 seconds

  start(key: string, phase: string, total: number, chainId?: number): void {
    this.states.set(key, {
      phase,
      chainId,
      current: 0,
      total,
      startTime: Date.now(),
      errors: 0
    });
    this.startDisplayInterval();
  }

  update(key: string, current: number, details?: string): void {
    const state = this.states.get(key);
    if (state) {
      state.current = current;
      if (details) state.details = details;
      this.maybeDisplay();
    }
  }

  increment(key: string, details?: string): void {
    const state = this.states.get(key);
    if (state) {
      state.current++;
      if (details) state.details = details;
      this.maybeDisplay();
    }
  }

  error(key: string): void {
    const state = this.states.get(key);
    if (state) {
      state.errors++;
    }
  }

  complete(key: string): void {
    const state = this.states.get(key);
    if (state) {
      const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1);
      const chainInfo = state.chainId ? ` [Chain ${state.chainId}]` : '';
      // Only log completion for important phases, not individual price fetches
      if (!state.phase.includes('Price Fetching') || process.env.VERBOSE_PROGRESS === 'true') {
        logger.info(
          `✓ ${state.phase}${chainInfo}: ${state.current}/${state.total} completed in ${elapsed}s` +
          (state.errors > 0 ? ` (${state.errors} errors)` : '')
        );
      }
      this.states.delete(key);
    }
    
    if (this.states.size === 0) {
      this.stopDisplayInterval();
    }
  }

  private maybeDisplay(): void {
    const now = Date.now();
    if (now - this.lastDisplayTime >= this.MIN_DISPLAY_INTERVAL) {
      this.display();
      this.lastDisplayTime = now;
    }
  }

  private display(): void {
    // Skip display if verbose logs are disabled
    if (process.env.DISABLE_VERBOSE_LOGS === 'true') {
      return;
    }
    
    const lines: string[] = [];
    
    // Group by phase
    const phaseGroups = new Map<string, ProgressState[]>();
    this.states.forEach(state => {
      const group = phaseGroups.get(state.phase) || [];
      group.push(state);
      phaseGroups.set(state.phase, group);
    });

    phaseGroups.forEach((states, phase) => {
      if (states.length === 1) {
        const state = states[0];
        if (state) {
          const percent = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
          const bar = this.createProgressBar(percent);
          const chainInfo = state.chainId ? ` [Chain ${state.chainId}]` : '';
          lines.push(`${phase}${chainInfo}: ${bar} ${state.current}/${state.total} (${percent}%)`);
          if (state.details) {
            lines.push(`  └─ ${state.details}`);
          }
        }
      } else {
        // Aggregate progress for same phase across chains
        const totalCurrent = states.reduce((sum, s) => sum + s.current, 0);
        const totalTotal = states.reduce((sum, s) => sum + s.total, 0);
        const percent = totalTotal > 0 ? Math.round((totalCurrent / totalTotal) * 100) : 0;
        const bar = this.createProgressBar(percent);
        lines.push(`${phase}: ${bar} ${totalCurrent}/${totalTotal} (${percent}%)`);
        
        // Show per-chain breakdown - but only if there are <= 5 chains
        if (states.length <= 5) {
          states.forEach(state => {
            const chainPercent = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
            const chainBar = this.createMiniProgressBar(chainPercent);
            lines.push(`  Chain ${state.chainId}: ${chainBar} ${state.current}/${state.total}`);
          });
        } else {
          lines.push(`  Processing ${states.length} chains...`);
        }
      }
    });

    if (lines.length > 0) {
      // Clear previous lines and display new ones
      console.log('\x1b[2K\r' + lines.join('\n'));
    }
  }

  private createProgressBar(percent: number, width = 20, chars = ['█', '░']): string {
    const safePercent = Math.max(0, Math.min(100, percent));
    const filled = Math.round((safePercent / 100) * width);
    return '[' + (chars[0] || '').repeat(filled) + (chars[1] || '').repeat(width - filled) + ']';
  }

  private createMiniProgressBar(percent: number): string {
    return this.createProgressBar(percent, 10, ['▪', '·']);
  }

  private startDisplayInterval(): void {
    // Don't start interval if verbose logs are disabled
    if (process.env.DISABLE_VERBOSE_LOGS === 'true') {
      return;
    }
    
    if (!this.displayInterval) {
      this.displayInterval = setInterval(() => {
        if (this.states.size > 0) {
          this.display();
        }
      }, 2000);
    }
  }

  private stopDisplayInterval(): void {
    if (this.displayInterval) {
      clearInterval(this.displayInterval);
      this.displayInterval = null;
    }
  }

  getStats(): { active: number; total: number; errors: number } {
    const totals = Array.from(this.states.values()).reduce(
      (acc, state) => ({ total: acc.total + state.total, errors: acc.errors + state.errors }),
      { total: 0, errors: 0 }
    );
    return { active: this.states.size, ...totals };
  }
}

export const progressTracker = new ProgressTracker();

// Helper functions for common operations
export const trackDiscovery = (chainId: number, total: number) => {
  const key = `discovery-${chainId}`;
  progressTracker.start(key, 'Token Discovery', total, chainId);
  return key;
};

export const trackPriceFetch = (chainId: number, source: string, total: number) => {
  const key = `price-${source}-${chainId}`;
  progressTracker.start(key, `Fetching ${source}`, total, chainId);
  return key;
};

export const trackBatch = (phase: string, total: number) => {
  const key = `batch-${phase}-${Date.now()}`;
  progressTracker.start(key, phase, total);
  return key;
};