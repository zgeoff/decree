import { expect, test } from 'vitest';
import type { StoreApi } from 'zustand';
import { createEngineStore } from './create-engine-store.ts';
import type { EngineState } from './types.ts';

function setupTest(): { store: StoreApi<EngineState> } {
  const store = createEngineStore();
  return { store };
}

test('it returns a store with empty initial state', () => {
  const { store } = setupTest();
  const state = store.getState();

  expect(state.workItems).toStrictEqual(new Map());
  expect(state.revisions).toStrictEqual(new Map());
  expect(state.specs).toStrictEqual(new Map());
  expect(state.agentRuns).toStrictEqual(new Map());
  expect(state.errors).toStrictEqual([]);
  expect(state.lastPlannedSHAs).toStrictEqual(new Map());
});

test('it initializes work items as an empty map', () => {
  const { store } = setupTest();
  const state = store.getState();

  expect(state.workItems).toBeInstanceOf(Map);
  expect(state.workItems.size).toBe(0);
});

test('it initializes revisions as an empty map', () => {
  const { store } = setupTest();
  const state = store.getState();

  expect(state.revisions).toBeInstanceOf(Map);
  expect(state.revisions.size).toBe(0);
});

test('it initializes specs as an empty map', () => {
  const { store } = setupTest();
  const state = store.getState();

  expect(state.specs).toBeInstanceOf(Map);
  expect(state.specs.size).toBe(0);
});

test('it initializes agent runs as an empty map', () => {
  const { store } = setupTest();
  const state = store.getState();

  expect(state.agentRuns).toBeInstanceOf(Map);
  expect(state.agentRuns.size).toBe(0);
});

test('it initializes errors as an empty array', () => {
  const { store } = setupTest();
  const state = store.getState();

  expect(Array.isArray(state.errors)).toBe(true);
  expect(state.errors).toHaveLength(0);
});

test('it initializes last planned SHAs as an empty map', () => {
  const { store } = setupTest();
  const state = store.getState();

  expect(state.lastPlannedSHAs).toBeInstanceOf(Map);
  expect(state.lastPlannedSHAs.size).toBe(0);
});

test('it returns a store that supports getState and setState', () => {
  const { store } = setupTest();

  expect(typeof store.getState).toBe('function');
  expect(typeof store.setState).toBe('function');
  expect(typeof store.subscribe).toBe('function');
});

test('it returns independent stores for each invocation', () => {
  const store1 = createEngineStore();
  const store2 = createEngineStore();

  expect(store1).not.toBe(store2);
  expect(store1.getState()).not.toBe(store2.getState());
});
