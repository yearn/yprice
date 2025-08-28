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
      logger.info(
        `✓ ${state.phase}${chainInfo}: ${state.current}/${state.total} completed in ${elapsed}s` +
        (state.errors > 0 ? ` (${state.errors} errors)` : '')
      );
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
        
        // Show per-chain breakdown
        states.forEach(state => {
          const chainPercent = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
          const chainBar = this.createMiniProgressBar(chainPercent);
          lines.push(`  Chain ${state.chainId}: ${chainBar} ${state.current}/${state.total}`);
        });
      }
    });

    if (lines.length > 0) {
      // Clear previous lines and display new ones
      console.log('\x1b[2K\r' + lines.join('\n'));
    }
  }

  private createProgressBar(percent: number): string {
    const width = 20;
    const safePercent = Math.max(0, Math.min(100, percent));
    const filled = Math.round((safePercent / 100) * width);
    const empty = Math.max(0, width - filled);
    return '[' + '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty)) + ']';
  }

  private createMiniProgressBar(percent: number): string {
    const width = 10;
    const safePercent = Math.max(0, Math.min(100, percent));
    const filled = Math.round((safePercent / 100) * width);
    const empty = Math.max(0, width - filled);
    return '[' + '▪'.repeat(Math.max(0, filled)) + '·'.repeat(Math.max(0, empty)) + ']';
  }

  private startDisplayInterval(): void {
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
    let total = 0;
    let errors = 0;
    
    this.states.forEach(state => {
      total += state.total;
      errors += state.errors;
    });
    
    return { active: this.states.size, total, errors };
  }
}

export const progressTracker = new ProgressTracker();

// Helper functions for common operations
export function trackDiscovery(chainId: number, total: number): string {
  const key = `discovery-${chainId}`;
  progressTracker.start(key, 'Token Discovery', total, chainId);
  return key;
}

export function trackPriceFetch(chainId: number, source: string, total: number): string {
  const key = `price-${source}-${chainId}`;
  progressTracker.start(key, `Fetching ${source}`, total, chainId);
  return key;
}

export function trackBatch(phase: string, total: number): string {
  const key = `batch-${phase}-${Date.now()}`;
  progressTracker.start(key, phase, total);
  return key;
}