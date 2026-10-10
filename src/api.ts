// HTTP client for the Node API in the Naprock-BandFlow workspace (server/index.mjs).
// Mirrors Naprock-BandFlow/lib/api.ts so the website and the phone app behave the same.

const tokenKey = 'bandflow_api_token';

// When VITE_API_URL is not set, use the computer that served this page: the Node API runs
// next to the Vite dev server, so this keeps working after changing Wi-Fi networks.
const apiUrl = (import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8787`).replace(/\/$/, '');

export type Role = 'worker' | 'boss';
export type WorkStatus = 'In Progress' | 'Review' | 'Done';
export type Priority = 'Low' | 'Medium' | 'High';
export type WorkerStatus = 'active' | 'away' | 'offline';

export type ApiUser = { id: string; email: string; fullName: string; role: Role };
export type ApiProfile = ApiUser & { phone: string; jobTitle: string; avatar: string | null; createdAt: string };
export type ProfileUpdate = Partial<Pick<ApiProfile, 'fullName' | 'email' | 'phone' | 'jobTitle' | 'avatar'>>;
export type ApiWorker = { id: string; name: string; email?: string; role?: Role; status?: WorkerStatus; created_at?: string; password_reset_requested_at?: string | null };

export type WorkloadLevel = 'light' | 'busy' | 'overloaded';
// open = works assigned to the worker that are not Done; the thresholds are set on the server.
export type Workload = { open: number; level: WorkloadLevel; busy_at: number; overloaded_at: number };
export type RecommendationBadge = 'recommended' | 'skill_mismatch' | 'high_workload' | 'away' | 'offline';
export type WorkerRecommendation = {
  worker_id: string;
  name: string;
  score: number;
  skill_match: number;
  open_works: number;
  status: WorkerStatus;
  reason: string;
  skills: string[];
  matched_skills: string[];
  workload: Workload;
  badges: RecommendationBadge[];
};
// source says where required_skills came from: the AI, the keyword fallback, or 'none' when no text was sent.
export type RecommendationResult = { required_skills: string[]; source: 'ai' | 'keywords' | 'none'; recommendations: WorkerRecommendation[] };

export type SubtaskDetail = {
  id: string;
  description: string;
  status: 'pending' | 'active' | 'done';
  order_index: number;
  started_at: string | null;
  completed_at: string | null;
};

export type WorkItem = {
  id: string;
  title: string;
  priority: Priority;
  status: WorkStatus;
  progress: number;
  due: string;
  assignedTo: string;
  eisenhowerCategory: string | null;
  subtasks: SubtaskDetail[];
};

export type NewWork = { title: string; priority: Priority; due?: string; subtasks?: string[]; assignedTo: string };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getApiUrl() {
  return apiUrl;
}

export function hasSession() {
  return Boolean(readToken());
}

function readToken() {
  try {
    return localStorage.getItem(tokenKey);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(tokenKey, token);
    else localStorage.removeItem(tokenKey);
  } catch {
    // Private browsing can block storage; the session then lasts until the tab closes.
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = readToken();
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    });
  } catch {
    throw new ApiError(`BandFlow server is unavailable at ${apiUrl}. Check that "npm run server" is running.`, 0);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status);
  return body as T;
}

export async function login(email: string, password: string) {
  const result = await request<{ token: string; user: ApiUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  writeToken(result.token);
  return result.user;
}

export async function signup(fullName: string, email: string, password: string) {
  await request('/auth/signup', { method: 'POST', body: JSON.stringify({ fullName, email, password }) });
}

export async function requestPasswordReset(email: string) {
  return request<{ ok: true }>('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function resetWorkerPassword(workerId: string, password: string) {
  return request<{ ok: true }>(`/workers/${workerId}/password`, { method: 'POST', body: JSON.stringify({ password }) });
}

export function logout() {
  writeToken(null);
}

export async function checkServer() {
  return request<{ ok: boolean }>('/health');
}

export async function getProfile() {
  return request<ApiProfile>('/me');
}

export async function updateProfile(update: ProfileUpdate) {
  return request<ApiProfile>('/me', { method: 'PATCH', body: JSON.stringify(update) });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return request<{ ok: true }>('/me/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
}

export async function getWorkers() {
  return request<ApiWorker[]>('/workers');
}

export async function updateWorkerStatus(workerId: string, status: WorkerStatus) {
  return request<{ id: string; status: WorkerStatus }>(`/workers/${workerId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

// Boss only: every worker ranked for the described work, best first. Empty text ranks by workload alone.
export async function recommendWorkers(text: string) {
  return request<RecommendationResult>('/work/recommend', { method: 'POST', body: JSON.stringify({ text }) });
}

type WorkRow = {
  id: string;
  title: string;
  priority: Priority;
  status: WorkStatus;
  progress: number;
  due: string;
  assigned_to: string;
  eisenhower_category?: string | null;
  subtask_details?: SubtaskDetail[];
};

export async function getWork(): Promise<WorkItem[]> {
  const rows = await request<WorkRow[]>('/work');
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    priority: row.priority,
    status: row.status,
    progress: row.progress,
    due: row.due,
    assignedTo: row.assigned_to,
    eisenhowerCategory: row.eisenhower_category ?? null,
    subtasks: row.subtask_details ?? [],
  }));
}

export type BandDelivery = { sent: boolean; error?: string }
// What the server's AI planner did when no steps were typed in.
export type AiPlanning = { used: boolean; steps?: number; error?: string }

export async function createWork(work: NewWork) {
  return request<{ id: string; band: BandDelivery; ai?: AiPlanning }>('/work', { method: 'POST', body: JSON.stringify(work) });
}

// Ticks or unticks one subtask. When the step on the wristband is finished, the server sends the next one.
export async function setSubtaskDone(workId: string, subtaskId: string, done: boolean) {
  return request<{ progress: number; band: BandDelivery | null }>(`/work/${workId}/subtasks/${subtaskId}`, { method: 'PATCH', body: JSON.stringify({ done }) })
}

export async function updateWorkStatus(workId: string, status: WorkStatus) {
  return request<{ id: string; status: WorkStatus }>(`/work/${workId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export async function deleteWork(workId: string) {
  return request<{ id: string }>(`/work/${workId}`, { method: 'DELETE' });
}
