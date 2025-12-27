// ============================================================================
// LiteQA - Model-Based Testing (State Machines)
// ============================================================================
//
// Model-based test generation using:
// - State machine definitions
// - Transition coverage
// - Path generation algorithms
// - Automatic test case derivation
//
// ============================================================================

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Step, Flow } from '../core/types';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface State {
  id: string;
  name: string;
  description?: string;
  initial?: boolean;
  final?: boolean;
  entryActions?: Step[];
  exitActions?: Step[];
  invariants?: StateInvariant[];
}

export interface StateInvariant {
  type: 'visible' | 'text' | 'url' | 'custom';
  selector?: string;
  value?: string;
  condition?: string;
}

export interface Transition {
  id: string;
  name: string;
  from: string;
  to: string;
  trigger?: string;
  guard?: string;
  actions: Step[];
  weight?: number;
  priority?: number;
}

export interface StateMachine {
  name: string;
  description?: string;
  version?: string;
  states: State[];
  transitions: Transition[];
  variables?: Record<string, unknown>;
}

export interface TestPath {
  name: string;
  description: string;
  states: string[];
  transitions: string[];
  steps: Step[];
  coverage: {
    statesCovered: number;
    transitionsCovered: number;
  };
}

export interface CoverageReport {
  totalStates: number;
  coveredStates: number;
  stateCoverage: number;
  totalTransitions: number;
  coveredTransitions: number;
  transitionCoverage: number;
  paths: TestPath[];
}

// ============================================================================
// State Machine Model
// ============================================================================

export class StateMachineModel {
  private machine: StateMachine;
  private stateMap: Map<string, State> = new Map();
  private transitionMap: Map<string, Transition[]> = new Map();

  constructor(machine: StateMachine) {
    this.machine = machine;
    this.buildMaps();
    this.validate();
  }

  /**
   * Load from YAML file
   */
  static fromFile(filePath: string): StateMachineModel {
    const content = fs.readFileSync(filePath, 'utf-8');
    const machine = yaml.load(content) as StateMachine;
    return new StateMachineModel(machine);
  }

  /**
   * Build internal maps for quick lookup
   */
  private buildMaps(): void {
    // State map
    for (const state of this.machine.states) {
      this.stateMap.set(state.id, state);
    }

    // Transition map (from state -> transitions)
    for (const transition of this.machine.transitions) {
      if (!this.transitionMap.has(transition.from)) {
        this.transitionMap.set(transition.from, []);
      }
      this.transitionMap.get(transition.from)!.push(transition);
    }
  }

  /**
   * Validate state machine
   */
  private validate(): void {
    // Check for initial state
    const initial = this.machine.states.find(s => s.initial);
    if (!initial) {
      throw new Error('State machine must have an initial state');
    }

    // Check transition references
    for (const transition of this.machine.transitions) {
      if (!this.stateMap.has(transition.from)) {
        throw new Error(`Transition "${transition.id}" references unknown state: ${transition.from}`);
      }
      if (!this.stateMap.has(transition.to)) {
        throw new Error(`Transition "${transition.id}" references unknown state: ${transition.to}`);
      }
    }

    logger.debug(`State machine validated: ${this.machine.states.length} states, ${this.machine.transitions.length} transitions`);
  }

  // ============================================================================
  // Getters
  // ============================================================================

  getInitialState(): State {
    return this.machine.states.find(s => s.initial)!;
  }

  getFinalStates(): State[] {
    return this.machine.states.filter(s => s.final);
  }

  getState(id: string): State | undefined {
    return this.stateMap.get(id);
  }

  getTransitionsFrom(stateId: string): Transition[] {
    return this.transitionMap.get(stateId) || [];
  }

  getAllStates(): State[] {
    return this.machine.states;
  }

  getAllTransitions(): Transition[] {
    return this.machine.transitions;
  }

  // ============================================================================
  // Path Generation Algorithms
  // ============================================================================

  /**
   * Generate all transition coverage paths (covers each transition at least once)
   */
  generateTransitionCoveragePaths(): TestPath[] {
    const paths: TestPath[] = [];
    const coveredTransitions = new Set<string>();
    const allTransitions = new Set(this.machine.transitions.map(t => t.id));

    while (coveredTransitions.size < allTransitions.size) {
      const path = this.generatePathCoveringUncovered(coveredTransitions);
      if (!path) break;

      paths.push(path);

      for (const tid of path.transitions) {
        coveredTransitions.add(tid);
      }
    }

    return paths;
  }

  /**
   * Generate all state coverage paths
   */
  generateStateCoveragePaths(): TestPath[] {
    const paths: TestPath[] = [];
    const coveredStates = new Set<string>();

    // Start with paths from initial to each final state
    const finalStates = this.getFinalStates();
    const initial = this.getInitialState();

    for (const final of finalStates) {
      const path = this.findPath(initial.id, final.id);
      if (path) {
        paths.push(path);
        for (const sid of path.states) {
          coveredStates.add(sid);
        }
      }
    }

    // Cover remaining states
    while (coveredStates.size < this.machine.states.length) {
      const uncovered = this.machine.states.find(s => !coveredStates.has(s.id));
      if (!uncovered) break;

      const pathToUncovered = this.findPath(initial.id, uncovered.id);
      if (pathToUncovered) {
        paths.push(pathToUncovered);
        for (const sid of pathToUncovered.states) {
          coveredStates.add(sid);
        }
      } else {
        // State is unreachable
        logger.warn(`State "${uncovered.id}" is unreachable from initial state`);
        coveredStates.add(uncovered.id);
      }
    }

    return paths;
  }

  /**
   * Generate random walk paths
   */
  generateRandomPaths(count: number, maxLength: number = 10): TestPath[] {
    const paths: TestPath[] = [];

    for (let i = 0; i < count; i++) {
      const path = this.generateRandomPath(maxLength);
      paths.push(path);
    }

    return paths;
  }

  /**
   * Generate paths covering n-switch coverage
   */
  generateNSwitchCoverage(n: number = 1): TestPath[] {
    // n-switch coverage: cover all sequences of n consecutive transitions
    const sequences = this.getAllTransitionSequences(n);
    const paths: TestPath[] = [];
    const coveredSequences = new Set<string>();

    for (const seq of sequences) {
      const seqKey = seq.join(',');
      if (coveredSequences.has(seqKey)) continue;

      const path = this.findPathWithSequence(seq);
      if (path) {
        paths.push(path);
        // Mark covered sequences
        for (let i = 0; i <= path.transitions.length - n; i++) {
          const subSeq = path.transitions.slice(i, i + n).join(',');
          coveredSequences.add(subSeq);
        }
      }
    }

    return paths;
  }

  // ============================================================================
  // Path Finding Algorithms
  // ============================================================================

  /**
   * Find shortest path between two states (BFS)
   */
  private findPath(fromId: string, toId: string): TestPath | null {
    const queue: { state: string; path: string[]; transitions: string[] }[] = [];
    const visited = new Set<string>();

    queue.push({ state: fromId, path: [fromId], transitions: [] });

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.state === toId) {
        return this.buildTestPath(current.path, current.transitions);
      }

      if (visited.has(current.state)) continue;
      visited.add(current.state);

      const transitions = this.getTransitionsFrom(current.state);
      for (const t of transitions) {
        if (!visited.has(t.to)) {
          queue.push({
            state: t.to,
            path: [...current.path, t.to],
            transitions: [...current.transitions, t.id],
          });
        }
      }
    }

    return null;
  }

  /**
   * Generate path covering uncovered transitions
   */
  private generatePathCoveringUncovered(covered: Set<string>): TestPath | null {
    const initial = this.getInitialState();
    const uncovered = this.machine.transitions.find(t => !covered.has(t.id));

    if (!uncovered) return null;

    // Find path to uncovered transition's source
    const pathToSource = this.findPath(initial.id, uncovered.from);
    if (!pathToSource) return null;

    // Add the uncovered transition
    const states = [...pathToSource.states, uncovered.to];
    const transitions = [...pathToSource.transitions, uncovered.id];

    // Try to reach a final state
    const finalStates = this.getFinalStates();
    for (const final of finalStates) {
      const pathToFinal = this.findPath(uncovered.to, final.id);
      if (pathToFinal) {
        states.push(...pathToFinal.states.slice(1));
        transitions.push(...pathToFinal.transitions);
        break;
      }
    }

    return this.buildTestPath(states, transitions);
  }

  /**
   * Generate random path
   */
  private generateRandomPath(maxLength: number): TestPath {
    const initial = this.getInitialState();
    const states: string[] = [initial.id];
    const transitions: string[] = [];

    let current = initial.id;
    let steps = 0;

    while (steps < maxLength) {
      const availableTransitions = this.getTransitionsFrom(current);
      if (availableTransitions.length === 0) break;

      // Random selection (weighted by priority)
      const weights = availableTransitions.map(t => t.priority || 1);
      const total = weights.reduce((a, b) => a + b, 0);
      let random = Math.random() * total;

      let selected = availableTransitions[0];
      for (let i = 0; i < availableTransitions.length; i++) {
        random -= weights[i];
        if (random <= 0) {
          selected = availableTransitions[i];
          break;
        }
      }

      states.push(selected.to);
      transitions.push(selected.id);
      current = selected.to;
      steps++;

      // Stop at final state
      const state = this.stateMap.get(current);
      if (state?.final) break;
    }

    return this.buildTestPath(states, transitions);
  }

  /**
   * Get all n-length transition sequences
   */
  private getAllTransitionSequences(n: number): string[][] {
    const sequences: string[][] = [];

    const traverse = (path: string[], current: string) => {
      if (path.length === n) {
        sequences.push([...path]);
        return;
      }

      const transitions = this.getTransitionsFrom(current);
      for (const t of transitions) {
        traverse([...path, t.id], t.to);
      }
    };

    const initial = this.getInitialState();
    const initialTransitions = this.getTransitionsFrom(initial.id);

    for (const t of initialTransitions) {
      traverse([t.id], t.to);
    }

    return sequences;
  }

  /**
   * Find path containing a specific sequence
   */
  private findPathWithSequence(sequence: string[]): TestPath | null {
    if (sequence.length === 0) return null;

    const firstTransition = this.machine.transitions.find(t => t.id === sequence[0]);
    if (!firstTransition) return null;

    // Find path to first transition
    const initial = this.getInitialState();
    const pathToStart = this.findPath(initial.id, firstTransition.from);
    if (!pathToStart) return null;

    // Add sequence
    const states = [...pathToStart.states];
    const transitions = [...pathToStart.transitions];

    let current = firstTransition.from;
    for (const tid of sequence) {
      const t = this.machine.transitions.find(tr => tr.id === tid);
      if (!t || t.from !== current) return null;
      states.push(t.to);
      transitions.push(t.id);
      current = t.to;
    }

    return this.buildTestPath(states, transitions);
  }

  // ============================================================================
  // Test Path Building
  // ============================================================================

  /**
   * Build TestPath from states and transitions
   */
  private buildTestPath(stateIds: string[], transitionIds: string[]): TestPath {
    const steps: Step[] = [];

    // Add entry actions for initial state
    const initialState = this.stateMap.get(stateIds[0]);
    if (initialState?.entryActions) {
      steps.push(...initialState.entryActions);
    }

    // Add invariant checks for initial state
    if (initialState?.invariants) {
      steps.push(...this.buildInvariantSteps(initialState.invariants));
    }

    // Process transitions
    for (let i = 0; i < transitionIds.length; i++) {
      const transition = this.machine.transitions.find(t => t.id === transitionIds[i])!;
      const fromState = this.stateMap.get(transition.from)!;
      const toState = this.stateMap.get(transition.to)!;

      // Exit actions from current state
      if (fromState.exitActions) {
        steps.push(...fromState.exitActions);
      }

      // Transition actions
      steps.push(...transition.actions);

      // Entry actions for new state
      if (toState.entryActions) {
        steps.push(...toState.entryActions);
      }

      // Invariant checks for new state
      if (toState.invariants) {
        steps.push(...this.buildInvariantSteps(toState.invariants));
      }
    }

    const name = `Path: ${stateIds.join(' -> ')}`;
    const coveredStates = new Set(stateIds).size;
    const coveredTransitions = new Set(transitionIds).size;

    return {
      name,
      description: `Test path covering ${coveredStates} states and ${coveredTransitions} transitions`,
      states: stateIds,
      transitions: transitionIds,
      steps,
      coverage: {
        statesCovered: coveredStates,
        transitionsCovered: coveredTransitions,
      },
    };
  }

  /**
   * Build steps for invariant checks
   */
  private buildInvariantSteps(invariants: StateInvariant[]): Step[] {
    const steps: Step[] = [];

    for (const inv of invariants) {
      switch (inv.type) {
        case 'visible':
          steps.push({
            action: 'expectVisible',
            selector: inv.selector!,
            description: `Verify ${inv.selector} is visible`,
          } as Step);
          break;

        case 'text':
          steps.push({
            action: 'expectText',
            selector: inv.selector!,
            text: inv.value!,
            description: `Verify text: ${inv.value}`,
          } as Step);
          break;

        case 'url':
          // Custom implementation needed
          steps.push({
            action: 'waitForLoadState',
            state: 'networkidle',
            description: 'Verify page loaded',
          } as Step);
          break;
      }
    }

    return steps;
  }

  // ============================================================================
  // Flow Generation
  // ============================================================================

  /**
   * Generate test flows from paths
   */
  generateFlows(paths: TestPath[]): Flow[] {
    return paths.map((path, index) => ({
      name: path.name || `Generated Test ${index + 1}`,
      description: path.description,
      runner: 'web' as const,
      steps: path.steps,
    }));
  }

  /**
   * Generate coverage report
   */
  generateCoverageReport(paths: TestPath[]): CoverageReport {
    const coveredStates = new Set<string>();
    const coveredTransitions = new Set<string>();

    for (const path of paths) {
      path.states.forEach(s => coveredStates.add(s));
      path.transitions.forEach(t => coveredTransitions.add(t));
    }

    return {
      totalStates: this.machine.states.length,
      coveredStates: coveredStates.size,
      stateCoverage: (coveredStates.size / this.machine.states.length) * 100,
      totalTransitions: this.machine.transitions.length,
      coveredTransitions: coveredTransitions.size,
      transitionCoverage: (coveredTransitions.size / this.machine.transitions.length) * 100,
      paths,
    };
  }

  /**
   * Save state machine diagram (Mermaid format)
   */
  toMermaid(): string {
    const lines = ['stateDiagram-v2'];

    for (const state of this.machine.states) {
      if (state.initial) {
        lines.push(`  [*] --> ${state.id}`);
      }
      if (state.final) {
        lines.push(`  ${state.id} --> [*]`);
      }
    }

    for (const t of this.machine.transitions) {
      lines.push(`  ${t.from} --> ${t.to}: ${t.name}`);
    }

    return lines.join('\n');
  }
}
