export type ContestStatus = 'setup' | 'open' | 'closed' | 'final' | 'archived';
export type SubmissionStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'reversed';

export interface Banner {
  contest_id: string;
  name: string;
  status: ContestStatus;
  start_at: string;
  end_at: string;
  grace_minutes: number;
  pending_count: number;
  finalized_at: string | null;
  results_updated_at: string | null;
}

export interface LeaderRow {
  display_name: string;
  points: number;
  tasks_completed: number;
  rank: number | null;
  reached_at: string | null;
  is_me: boolean;
  category_counts: Record<string, number> | null;
}

export interface AdminLeaderRow {
  member_id: string;
  email: string;
  display_name: string;
  title: string | null;
  points: number;
  tasks_completed: number;
  rank: number | null;
  reached_at: string | null;
  pending_count: number;
  active: boolean;
}

export interface Category {
  id: string;
  name: string;
  points: number;
  reference_label: string;
  reference_hint: string;
  active: boolean;
  sort_order: number;
}

export interface MySubmission {
  id: string;
  category_id: string;
  category_name: string;
  category_points: number;
  reference: string;
  note: string | null;
  status: SubmissionStatus;
  attempt: number;
  resubmission_of: string | null;
  points_awarded: number | null;
  reject_reason_code: string | null;
  reject_reason_text: string | null;
  proof_path: string;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  can_resubmit: boolean;
  resubmit_block: string | null;
}

export interface AdminSubmission {
  id: string;
  contest_id: string;
  member_id: string;
  category_id: string;
  reference: string;
  note: string | null;
  proof_path: string;
  status: SubmissionStatus;
  attempt: number;
  resubmission_of: string | null;
  override_granted: boolean;
  flags: string[];
  points_awarded: number | null;
  reject_reason_code: string | null;
  reject_reason_text: string | null;
  claimed_by: string | null;
  claimed_until: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  submitted_at: string | null;
  member?: { display_name: string; email: string; title?: string | null } | null;
  category?: { name: string; points: number; reference_label: string } | null;
}

export interface AdminRow {
  id: string;
  email: string;
  role: 'owner' | 'admin';
  active: boolean;
  created_at: string;
}

export interface ContestRow {
  id: string;
  name: string;
  start_at: string;
  end_at: string;
  ended_at: string | null;
  grace_minutes: number;
  manual_status: string;
  points_unlocked: boolean;
  finalized_at: string | null;
  results_updated_at: string | null;
  exported_at: string | null;
}

export interface AuditRow {
  id: number;
  created_at: string;
  actor_type: 'member' | 'admin' | 'system';
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
