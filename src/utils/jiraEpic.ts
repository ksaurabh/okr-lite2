const API_URL = import.meta.env.VITE_API_URL || '';

export interface JiraMatch {
  key: string;
  summary: string;
  url: string;
}

interface ObjectiveLike {
  id: string;
  title: string;
  description?: string;
}

async function findEpicsByTitle(title: string): Promise<JiraMatch[]> {
  try {
    const res = await fetch(`${API_URL}/api/jira/find-epics?title=${encodeURIComponent(title)}`, {
      credentials: 'include',
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.matches) ? data.matches : [];
  } catch {
    // If the duplicate-check fails (network/endpoint), don't block creation.
    return [];
  }
}

async function createEpic(obj: ObjectiveLike): Promise<{ key: string; url: string }> {
  const res = await fetch(`${API_URL}/api/jira/create-epic`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: obj.title, description: obj.description, objectiveId: obj.id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { key: data.key, url: data.url };
}

/**
 * Resolve a Jira epic for an objective. Before creating, checks for an existing
 * ticket with the same title; if found, asks the user whether to link to the
 * existing one or create a duplicate. Returns the {key, url} to attach to the
 * objective, or null if the user cancelled.
 */
export async function resolveJiraEpicForObjective(obj: ObjectiveLike): Promise<{ key: string; url: string } | null> {
  const matches = await findEpicsByTitle(obj.title);

  if (matches.length > 0) {
    const list = matches.slice(0, 10).map(m => `• ${m.key}: ${m.summary}`).join('\n');
    const useExisting = window.confirm(
      `A Jira ticket with this title already exists:\n\n${list}\n\n` +
      `OK — link this objective to ${matches[0].key}\n` +
      `Cancel — choose whether to create a new duplicate`
    );
    if (useExisting) {
      return { key: matches[0].key, url: matches[0].url };
    }
    const createDuplicate = window.confirm(`Create a new (duplicate) Jira ticket titled "${obj.title}"?`);
    if (!createDuplicate) return null;
  }

  return createEpic(obj);
}
