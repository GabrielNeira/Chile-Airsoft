import { supabase } from './supabaseClient';

interface SupabaseLikeError {
  code?: string;
  message?: string;
}

function isMissingRelationError(error: unknown): boolean {
  const e = error as SupabaseLikeError;
  const message = (e?.message ?? '').toLowerCase();
  return message.includes('could not find the table') || message.includes('schema cache') || message.includes('does not exist');
}

export interface OperatorIdMetricsRow {
  operator_user_id: string;
  credential_code?: string | null;
  nickname: string;
  real_name: string;
  operator_role: string;
  team: string | null;
  blood_group: string;
  operator_score: number | null;
  fair_play_score: number | null;
  events_experience_score: number | null;
  achievements_score: number | null;
  total_confirmed_events: number | null;
  total_achievements_unlocked: number | null;
  total_fair_play_green: number | null;
  total_fair_play_yellow: number | null;
  total_fair_play_red: number | null;
  metrics_updated_at: string | null;
}

export async function getOperatorIdMetricsByNickname(nickname: string): Promise<OperatorIdMetricsRow | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('v_operator_id_metrics')
    .select(
      'operator_user_id,nickname,real_name,operator_role,team,blood_group,operator_score,fair_play_score,events_experience_score,achievements_score,total_confirmed_events,total_achievements_unlocked,total_fair_play_green,total_fair_play_yellow,total_fair_play_red,metrics_updated_at'
    )
    .eq('nickname', nickname)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }

  return (data as OperatorIdMetricsRow | null) ?? null;
}

export async function getOperatorIdMetricsByUserId(userId: string): Promise<OperatorIdMetricsRow | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('v_operator_id_metrics')
    .select(
      'operator_user_id,nickname,real_name,operator_role,team,blood_group,operator_score,fair_play_score,events_experience_score,achievements_score,total_confirmed_events,total_achievements_unlocked,total_fair_play_green,total_fair_play_yellow,total_fair_play_red,metrics_updated_at,credential_code'
    )
    .eq('operator_user_id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }

  return (data as OperatorIdMetricsRow | null) ?? null;
}

export async function getOperatorMetricScoreByUserId(userId: string): Promise<number | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('operator_metric_scores')
    .select('operator_score')
    .eq('operator_user_id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }

  if (!data) {
    return null;
  }

  const rawScore = (data as { operator_score?: unknown }).operator_score;
  const parsedScore = typeof rawScore === 'number' ? rawScore : Number(rawScore);
  if (!Number.isFinite(parsedScore)) {
    return null;
  }

  return Math.round(parsedScore);
}
