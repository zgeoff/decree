import { expect, test, vi } from 'vitest';
import { createMockGitHubClient } from '../../../test-utils/create-mock-github-client.ts';
import type { WorkItemWriterConfig } from './create-work-item-writer.ts';
import { createWorkItemWriter } from './create-work-item-writer.ts';

function buildConfig(): WorkItemWriterConfig {
  return { owner: 'test-owner', repo: 'test-repo' };
}

function setupTest(): {
  writer: ReturnType<typeof createWorkItemWriter>;
  client: ReturnType<typeof createMockGitHubClient>;
} {
  const client = createMockGitHubClient();
  const writer = createWorkItemWriter({ client, config: buildConfig() });
  return { writer, client };
}

// --- transitionStatus ---

test('it removes the old status label and adds the new one when transitioning status', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.listLabelsOnIssue).mockResolvedValue({
    data: [{ name: 'status:pending' }, { name: 'task:implement' }],
  });
  vi.mocked(client.issues.removeLabel).mockResolvedValue({ data: {} });
  vi.mocked(client.issues.addLabels).mockResolvedValue({ data: {} });

  await writer.transitionStatus('42', 'in-progress');

  expect(client.issues.removeLabel).toHaveBeenCalledWith(
    expect.objectContaining({ issue_number: 42, name: 'status:pending' }),
  );
  expect(client.issues.addLabels).toHaveBeenCalledWith(
    expect.objectContaining({ issue_number: 42, labels: ['status:in-progress'] }),
  );
});

test('it closes the issue when transitioning to closed status', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.listLabelsOnIssue).mockResolvedValue({
    data: [{ name: 'status:review' }],
  });
  vi.mocked(client.issues.removeLabel).mockResolvedValue({ data: {} });
  vi.mocked(client.issues.addLabels).mockResolvedValue({ data: {} });
  vi.mocked(client.issues.update).mockResolvedValue({
    data: { number: 42, title: 'Test', labels: [], body: '', created_at: '' },
  });

  await writer.transitionStatus('42', 'closed');

  expect(client.issues.addLabels).toHaveBeenCalledWith(
    expect.objectContaining({ labels: ['status:closed'] }),
  );
  expect(client.issues.update).toHaveBeenCalledWith(
    expect.objectContaining({ issue_number: 42, state: 'closed' }),
  );
});

test('it does not close the issue when transitioning to a non-closed status', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.listLabelsOnIssue).mockResolvedValue({
    data: [{ name: 'status:pending' }],
  });
  vi.mocked(client.issues.removeLabel).mockResolvedValue({ data: {} });
  vi.mocked(client.issues.addLabels).mockResolvedValue({ data: {} });

  await writer.transitionStatus('42', 'in-progress');

  expect(client.issues.update).not.toHaveBeenCalled();
});

test('it removes multiple status labels when more than one exists', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.listLabelsOnIssue).mockResolvedValue({
    data: [{ name: 'status:pending' }, { name: 'status:blocked' }],
  });
  vi.mocked(client.issues.removeLabel).mockResolvedValue({ data: {} });
  vi.mocked(client.issues.addLabels).mockResolvedValue({ data: {} });

  await writer.transitionStatus('5', 'review');

  expect(client.issues.removeLabel).toHaveBeenCalledTimes(2);
});

// --- createWorkItem ---

test('it appends dependency metadata comment when blockedBy is non-empty', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.create).mockResolvedValue({
    data: {
      number: 99,
      title: 'New task',
      labels: [{ name: 'task:implement' }, { name: 'status:pending' }],
      body: 'Task body\n\n<!-- decree:blockedBy #42 #43 -->',
      created_at: '2026-01-01T00:00:00Z',
    },
  });

  await writer.createWorkItem('New task', 'Task body', [], ['42', '43']);

  expect(client.issues.create).toHaveBeenCalledWith(
    expect.objectContaining({
      body: 'Task body\n\n<!-- decree:blockedBy #42 #43 -->',
      labels: ['task:implement'],
    }),
  );
});

test('it does not include a dependency metadata comment when blockedBy is empty', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.create).mockResolvedValue({
    data: {
      number: 100,
      title: 'Simple task',
      labels: [{ name: 'task:implement' }],
      body: 'Simple body',
      created_at: '2026-01-01T00:00:00Z',
    },
  });

  await writer.createWorkItem('Simple task', 'Simple body', [], []);

  expect(client.issues.create).toHaveBeenCalledWith(
    expect.objectContaining({
      body: 'Simple body',
    }),
  );
});

test('it always includes the task:implement label in created issues', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.create).mockResolvedValue({
    data: {
      number: 101,
      title: 'Task',
      labels: [{ name: 'task:implement' }, { name: 'custom-label' }],
      body: 'Body',
      created_at: '2026-01-01T00:00:00Z',
    },
  });

  await writer.createWorkItem('Task', 'Body', ['custom-label'], []);

  expect(client.issues.create).toHaveBeenCalledWith(
    expect.objectContaining({
      labels: ['task:implement', 'custom-label'],
    }),
  );
});

test('it returns the created issue as a mapped work item', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.create).mockResolvedValue({
    data: {
      number: 50,
      title: 'Created task',
      labels: [{ name: 'task:implement' }, { name: 'status:pending' }, { name: 'priority:high' }],
      body: 'Task content\n\n<!-- decree:blockedBy #10 -->',
      created_at: '2026-02-15T12:00:00Z',
    },
  });

  const result = await writer.createWorkItem('Created task', 'Task content', [], ['10']);

  expect(result).toStrictEqual({
    id: '50',
    title: 'Created task',
    status: 'pending',
    priority: 'high',
    complexity: null,
    blockedBy: ['10'],
    createdAt: '2026-02-15T12:00:00Z',
    linkedRevision: null,
  });
});

// --- updateWorkItem ---

test('it preserves existing dependency metadata when updating the body', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.get).mockResolvedValue({
    data: {
      number: 42,
      title: 'Test',
      labels: [],
      body: 'Old content\n\n<!-- decree:blockedBy #10 #20 -->',
      created_at: '',
    },
  });
  vi.mocked(client.issues.update).mockResolvedValue({
    data: { number: 42, title: 'Test', labels: [], body: '', created_at: '' },
  });

  await writer.updateWorkItem('42', 'New content', null);

  expect(client.issues.update).toHaveBeenCalledWith(
    expect.objectContaining({
      body: 'New content\n\n<!-- decree:blockedBy #10 #20 -->',
    }),
  );
});

test('it makes no api calls when both body and labels are null', async () => {
  const { writer, client } = setupTest();

  await writer.updateWorkItem('42', null, null);

  expect(client.issues.get).not.toHaveBeenCalled();
  expect(client.issues.update).not.toHaveBeenCalled();
  expect(client.issues.listLabelsOnIssue).not.toHaveBeenCalled();
});

test('it preserves reserved labels when updating labels', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.listLabelsOnIssue).mockResolvedValue({
    data: [{ name: 'task:implement' }, { name: 'status:in-progress' }, { name: 'old-label' }],
  });
  vi.mocked(client.issues.update).mockResolvedValue({
    data: { number: 42, title: 'Test', labels: [], body: '', created_at: '' },
  });

  await writer.updateWorkItem('42', null, ['new-label']);

  expect(client.issues.update).toHaveBeenCalledWith(
    expect.objectContaining({
      labels: ['task:implement', 'status:in-progress', 'new-label'],
    }),
  );
});

test('it updates only the body when labels is null', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.get).mockResolvedValue({
    data: {
      number: 42,
      title: 'Test',
      labels: [],
      body: 'Old body',
      created_at: '',
    },
  });
  vi.mocked(client.issues.update).mockResolvedValue({
    data: { number: 42, title: 'Test', labels: [], body: '', created_at: '' },
  });

  await writer.updateWorkItem('42', 'Updated body', null);

  expect(client.issues.update).toHaveBeenCalledWith(
    expect.objectContaining({ body: 'Updated body' }),
  );
  expect(client.issues.listLabelsOnIssue).not.toHaveBeenCalled();
});

test('it updates only the labels when body is null', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.listLabelsOnIssue).mockResolvedValue({
    data: [{ name: 'status:pending' }],
  });
  vi.mocked(client.issues.update).mockResolvedValue({
    data: { number: 42, title: 'Test', labels: [], body: '', created_at: '' },
  });

  await writer.updateWorkItem('42', null, ['feature']);

  expect(client.issues.get).not.toHaveBeenCalled();
  expect(client.issues.update).toHaveBeenCalledWith(
    expect.objectContaining({
      labels: ['status:pending', 'feature'],
    }),
  );
});

test('it preserves body without metadata when issue has no dependency comment', async () => {
  const { writer, client } = setupTest();

  vi.mocked(client.issues.get).mockResolvedValue({
    data: {
      number: 42,
      title: 'Test',
      labels: [],
      body: 'Just content',
      created_at: '',
    },
  });
  vi.mocked(client.issues.update).mockResolvedValue({
    data: { number: 42, title: 'Test', labels: [], body: '', created_at: '' },
  });

  await writer.updateWorkItem('42', 'New content', null);

  expect(client.issues.update).toHaveBeenCalledWith(
    expect.objectContaining({ body: 'New content' }),
  );
});

test('it wraps api calls with the retry utility', async () => {
  const { writer, client } = setupTest();

  const transientError = { status: 500 };
  vi.mocked(client.issues.listLabelsOnIssue)
    .mockRejectedValueOnce(transientError)
    .mockResolvedValue({ data: [] });
  vi.mocked(client.issues.addLabels).mockResolvedValue({ data: {} });

  vi.useFakeTimers();

  const promise = writer.transitionStatus('1', 'ready');

  await vi.advanceTimersByTimeAsync(3000);

  await promise;

  expect(client.issues.listLabelsOnIssue).toHaveBeenCalledTimes(2);
});
