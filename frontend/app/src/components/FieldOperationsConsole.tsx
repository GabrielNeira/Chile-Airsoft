import { DragEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import './field-operations-console.css';

type TeamSlot = 'alpha' | 'bravo' | 'reserve';
type CardType = 'green' | 'yellow' | 'red';
type MatchStatus = 'planned' | 'running' | 'finished';
type BoardView = 'evento' | 'equipos' | 'partidas' | 'tarjetas' | 'superadmin';
type PlayerKind = 'operator' | 'guest';

interface FieldOperationsConsoleProps {
  operatorNickname: string;
  operatorCredentialId?: string;
  sessionUserId: string;
  allowedViews?: BoardView[];
  initialView?: BoardView;
}

interface FieldRow {
  id: string;
  name: string;
  city: string | null;
}

interface EventRow {
  id: string;
  title: string;
  event_date: string;
  starts_at: string | null;
  ends_at: string | null;
  scheduled_at?: string | null;
  max_players?: number | null;
  registration_closed_at?: string | null;
  field_id: string;
  created_at: string;
}

interface AssignmentRow {
  operator_user_id: string;
  team_slot: TeamSlot;
  day_role?: string | null;
  assignment_note?: string | null;
  is_active?: boolean | null;
}

interface GuestAssignmentRow {
  guest_player_id: string;
  team_slot: TeamSlot;
  day_role?: string | null;
  assignment_note?: string | null;
  is_active?: boolean | null;
}

interface MatchRow {
  id: string;
  title: string;
  status: MatchStatus;
  starts_at: string | null;
  ends_at: string | null;
  duration_seconds: number | null;
  winner_team: TeamSlot | null;
  paused_at?: string | null;
  total_paused_seconds?: number | null;
  created_at: string;
}

interface CardRow {
  id: string;
  playerKey: string;
  playerId: string;
  kind: PlayerKind;
  card_type: CardType;
  detail: string;
  issued_at: string;
}

interface OperatorCardRow {
  id: string;
  operator_user_id: string;
  card_type: CardType;
  detail: string;
  issued_at: string;
}

interface GuestCardRow {
  id: string;
  guest_player_id: string;
  card_type: CardType;
  detail: string;
  issued_at: string;
}

interface PlayerMetrics {
  total_confirmed_events: number;
  total_fair_play_green: number;
  total_fair_play_yellow: number;
  total_fair_play_red: number;
  total_matches_participated: number;
  total_matches_won: number;
  total_matches_lost: number;
  total_field_time_seconds: number;
}

interface RosterPlayer {
  kind: PlayerKind;
  userId: string;
  entityId: string;
  operatorUserId?: string;
  guestPlayerId?: string;
  nickname: string;
  role: string;
  bloodGroup: string;
  teamHint?: string;
  teamSlot: TeamSlot;
  dayRole: string;
  assignmentNote: string;
  isActiveInEvent: boolean;
  isMinor: boolean;
  metrics: PlayerMetrics;
  cardsInEvent: number;
}

interface OperatorLookup {
  kind: 'operator';
  userId: string;
  nickname: string;
  role: string;
  bloodGroup: string;
  teamHint?: string;
}

interface GuestLookup {
  kind: 'guest';
  guestPlayerId: string;
  nickname: string;
  bloodGroup: string;
  teamHint?: string;
  isMinor: boolean;
}

type PlayerLookup = OperatorLookup | GuestLookup;

interface GuestPlayerRow {
  id: string;
  nickname: string;
  rut: string | null;
  blood_group: string | null;
  team_hint: string | null;
  is_minor: boolean;
  note: string | null;
}

interface PaidRegistrationRow {
  id: string;
  event_id: string;
  payment_order_id: string;
  operator_user_id: string | null;
  guest_nickname: string | null;
  guest_rut_normalized: string | null;
  guest_blood_group: string | null;
  is_minor: boolean;
  registration_status: 'paid' | 'present' | 'assigned' | 'cancelled' | 'refunded';
  team_slot: TeamSlot | null;
  checked_in_at: string | null;
  assigned_at: string | null;
  metadata: Record<string, unknown> | null;
}

interface MetricRowRaw {
  operator_user_id: string;
  total_confirmed_events?: number | null;
  total_fair_play_green?: number | null;
  total_fair_play_yellow?: number | null;
  total_fair_play_red?: number | null;
  total_matches_participated?: number | null;
  total_matches_won?: number | null;
  total_matches_lost?: number | null;
  total_field_time_seconds?: number | null;
}

interface FieldAdminRow {
  user_id: string;
  email: string;
  assigned_at: string;
}

const TEAM_LABEL: Record<TeamSlot, string> = {
  alpha: 'Team Alpha',
  bravo: 'Team Bravo',
  reserve: 'Reserva'
};

const PLAYER_KEY_PREFIX: Record<PlayerKind, string> = {
  operator: 'operator:',
  guest: 'guest:'
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function defaultMetrics(): PlayerMetrics {
  return {
    total_confirmed_events: 0,
    total_fair_play_green: 0,
    total_fair_play_yellow: 0,
    total_fair_play_red: 0,
    total_matches_participated: 0,
    total_matches_won: 0,
    total_matches_lost: 0,
    total_field_time_seconds: 0
  };
}

function toMinutesLabel(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const minutes = Math.floor(safe / 60);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function normalizeRut(rawRut: string): string {
  return rawRut.toUpperCase().replace(/[^0-9K]/g, '');
}

function toPlayerKey(kind: PlayerKind, entityId: string): string {
  return `${PLAYER_KEY_PREFIX[kind]}${entityId}`;
}

function buildGuestNickname(normalizedRut: string, fallbackNickname: string): string {
  if (fallbackNickname.trim()) {
    return fallbackNickname.trim();
  }

  if (normalizedRut) {
    return `INV-${normalizedRut.slice(-4)}`;
  }

  return 'Invitado sin registro';
}

function toIsoDateTime(dateValue: string, timeValue: string): string | null {
  const dateToken = dateValue.trim();
  const timeToken = timeValue.trim();
  if (!dateToken || !timeToken) {
    return null;
  }

  const safeTime = /^\d{2}:\d{2}$/.test(timeToken) ? timeToken : `${timeToken}:00`;
  const candidate = `${dateToken}T${safeTime}:00`;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function toInputTimeLabel(isoValue: string | null | undefined): string {
  if (!isoValue) {
    return '';
  }

  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const hh = String(parsed.getHours()).padStart(2, '0');
  const mm = String(parsed.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function mapError(error: unknown): string {
  const message = (error as { message?: string })?.message ?? 'Error inesperado.';
  const lower = message.toLowerCase();

  if (lower.includes('row-level security')) {
    return 'No tienes permisos para esta accion. Verifica rol organizer/field_admin en Supabase.';
  }

  if (lower.includes('event_id,operator_user_id') || lower.includes('duplicate key')) {
    return 'El jugador ya estaba registrado en este evento.';
  }

  if (lower.includes('event_id,guest_player_id')) {
    return 'El invitado ya estaba registrado en este evento.';
  }

  return message;
}

function isMissingRpcError(error: { code?: string; message?: string } | null): boolean {
  if (!error) {
    return false;
  }

  const message = error.message?.toLowerCase() ?? '';
  return error.code === 'PGRST202' || message.includes('could not find the function');
}

export default function FieldOperationsConsole({
  operatorNickname,
  operatorCredentialId,
  sessionUserId,
  allowedViews,
  initialView
}: FieldOperationsConsoleProps) {
  const [activeView, setActiveView] = useState<BoardView>(initialView ?? 'evento');
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [activeEventId, setActiveEventId] = useState('');

  const [eventTitle, setEventTitle] = useState('Jornada Airsoft');
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [eventTime, setEventTime] = useState('09:00');
  const [eventMaxPlayers, setEventMaxPlayers] = useState('40');
  const [eventFieldId, setEventFieldId] = useState('');

  const [eventEditTitle, setEventEditTitle] = useState('');
  const [eventEditDate, setEventEditDate] = useState('');
  const [eventEditTime, setEventEditTime] = useState('');
  const [eventEditMaxPlayers, setEventEditMaxPlayers] = useState('');

  const [rutInput, setRutInput] = useState('');
  const [playerNameInput, setPlayerNameInput] = useState('');
  const [allowGuestRegistration, setAllowGuestRegistration] = useState(false);
  const [guestIsMinor, setGuestIsMinor] = useState(false);

  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [paidRegistrations, setPaidRegistrations] = useState<PaidRegistrationRow[]>([]);

  const [matchLabel, setMatchLabel] = useState('Ronda principal');
  const [winnerTeam, setWinnerTeam] = useState<TeamSlot>('alpha');
  const [timerNow, setTimerNow] = useState(() => Date.now());

  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [selectedPlayerDayRole, setSelectedPlayerDayRole] = useState('');
  const [selectedPlayerNote, setSelectedPlayerNote] = useState('');
  const [selectedPlayerActive, setSelectedPlayerActive] = useState(true);
  const [quickCardDetail, setQuickCardDetail] = useState('');

  const [cardEditorId, setCardEditorId] = useState('');
  const [cardEditorType, setCardEditorType] = useState<CardType>('yellow');
  const [cardEditorDetail, setCardEditorDetail] = useState('');

  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Listo para administrar canchas con base en ID.');
  const [missingTables, setMissingTables] = useState(false);
  const [canManageFieldAdmins, setCanManageFieldAdmins] = useState(false);
  const [adminFieldId, setAdminFieldId] = useState('');
  const [fieldAdminEmailInput, setFieldAdminEmailInput] = useState('');
  const [fieldAdmins, setFieldAdmins] = useState<FieldAdminRow[]>([]);
  const [fieldAdminBusy, setFieldAdminBusy] = useState(false);
  const isHomuraSuperAdmin = canManageFieldAdmins;

  const activeEvent = useMemo(
    () => events.find((eventItem) => eventItem.id === activeEventId) ?? null,
    [activeEventId, events]
  );

  const registrationLocked = Boolean(activeEvent?.registration_closed_at || activeEvent?.ends_at);

  const availableViews = useMemo(() => {
    const baseViews: BoardView[] = [
      'evento',
      'equipos',
      'partidas',
      'tarjetas',
      ...(isHomuraSuperAdmin ? (['superadmin'] as BoardView[]) : [])
    ];

    if (!allowedViews || allowedViews.length === 0) {
      return baseViews;
    }

    return baseViews.filter((view) => allowedViews.includes(view));
  }, [allowedViews, isHomuraSuperAdmin]);

  const selectableEvents = useMemo(() => events, [events]);

  const runningMatch = useMemo(
    () => matches.find((match) => match.status === 'running') ?? null,
    [matches]
  );

  const selectedPlayer = useMemo(
    () => players.find((player) => player.userId === selectedPlayerId) ?? null,
    [players, selectedPlayerId]
  );

  useEffect(() => {
    if (!selectedPlayer) {
      setSelectedPlayerDayRole('');
      setSelectedPlayerNote('');
      setSelectedPlayerActive(true);
      return;
    }

    setSelectedPlayerDayRole(selectedPlayer.dayRole);
    setSelectedPlayerNote(selectedPlayer.assignmentNote);
    setSelectedPlayerActive(selectedPlayer.isActiveInEvent);
  }, [selectedPlayer]);

  useEffect(() => {
    if (availableViews.length === 0) {
      return;
    }

    if (!availableViews.includes(activeView)) {
      setActiveView(availableViews[0]);
    }
  }, [availableViews, activeView]);

  useEffect(() => {
    if (!activeEvent) {
      setEventEditTitle('');
      setEventEditDate('');
      setEventEditTime('');
      setEventEditMaxPlayers('');
      return;
    }

    setEventEditTitle(activeEvent.title);
    setEventEditDate(activeEvent.event_date);
    setEventEditTime(toInputTimeLabel(activeEvent.scheduled_at));
    setEventEditMaxPlayers(activeEvent.max_players ? String(activeEvent.max_players) : '');
  }, [activeEvent]);

  const teamBuckets = useMemo(() => {
    const alpha = players.filter((player) => player.teamSlot === 'alpha');
    const bravo = players.filter((player) => player.teamSlot === 'bravo');
    const reserve = players.filter((player) => player.teamSlot === 'reserve');
    return { alpha, bravo, reserve };
  }, [players]);

  const eventDurationSeconds = useMemo(() => {
    return matches
      .filter((match) => match.status === 'finished')
      .reduce((acc, match) => acc + Math.max(0, match.duration_seconds ?? 0), 0);
  }, [matches]);

  const elapsedLabel = useMemo(() => {
    if (!runningMatch?.starts_at) {
      return '00:00';
    }

    const startedMs = new Date(runningMatch.starts_at).getTime();
    const totalPaused = Math.max(0, Number(runningMatch.total_paused_seconds ?? 0));
    const pausedLive = runningMatch.paused_at
      ? Math.max(0, Math.floor((timerNow - new Date(runningMatch.paused_at).getTime()) / 1000))
      : 0;
    const currentMs = runningMatch.paused_at ? new Date(runningMatch.paused_at).getTime() : timerNow;

    const elapsedSec = Math.max(0, Math.floor((currentMs - startedMs) / 1000) - totalPaused);
    const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const ss = String(elapsedSec % 60).padStart(2, '0');

    if (runningMatch.paused_at) {
      return `${mm}:${ss} (pausada +${pausedLive}s)`;
    }

    return `${mm}:${ss}`;
  }, [runningMatch, timerNow]);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setStatusMessage('Debes configurar Supabase para administrar eventos reales.');
      return;
    }

    void loadInitialData();
  }, []);

  useEffect(() => {
    if (!activeEventId) {
      setPlayers([]);
      setMatches([]);
      setCards([]);
      setPaidRegistrations([]);
      return;
    }

    void loadEventData(activeEventId);
  }, [activeEventId]);

  useEffect(() => {
    if (!canManageFieldAdmins || !supabase || !adminFieldId) {
      setFieldAdmins([]);
      return;
    }

    void loadFieldAdminsByField(adminFieldId);
  }, [canManageFieldAdmins, adminFieldId]);

  useEffect(() => {
    if (!runningMatch) {
      return;
    }

    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [runningMatch]);

  async function resolveFieldOperationsAccess(): Promise<boolean> {
    if (!supabase) {
      return false;
    }

    const accessRpc = await supabase.rpc('can_access_field_operations');
    if (!accessRpc.error && accessRpc.data === true) {
      return true;
    }

    const organizerRpc = await supabase.rpc('is_platform_organizer');
    if (!organizerRpc.error && organizerRpc.data === true) {
      return true;
    }

    if (
      !isMissingRpcError(accessRpc.error)
      && !isMissingRpcError(organizerRpc.error)
      && organizerRpc.error
    ) {
      throw organizerRpc.error;
    }

    const roleCheckPrimary = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', sessionUserId)
      .in('role', ['field_admin', 'organizer', 'super_admin'])
      .limit(1);

    if (!roleCheckPrimary.error && roleCheckPrimary.data && roleCheckPrimary.data.length > 0) {
      return true;
    }

    const roleCheckLegacy = await supabase
      .from('user_roles')
      .select('user_role')
      .eq('user_id', sessionUserId)
      .in('user_role', ['field_admin', 'organizer', 'super_admin'])
      .limit(1);

    if (!roleCheckLegacy.error && roleCheckLegacy.data && roleCheckLegacy.data.length > 0) {
      return true;
    }

    return false;
  }

  async function loadInitialData() {
    if (!supabase) {
      return;
    }

    setBusy(true);
    try {
      await resolveFieldOperationsAccess();

      const maintainRpc = await supabase.rpc('can_manage_field_admins_by_email');
      const canMaintainAdmins = !maintainRpc.error && maintainRpc.data === true;
      setCanManageFieldAdmins(canMaintainAdmins);

      let scopedFields: FieldRow[] = [];

      if (canMaintainAdmins) {
        const fieldsRes = await supabase.from('fields').select('id,name,city').order('name');
        if (fieldsRes.error) throw fieldsRes.error;
        scopedFields = (fieldsRes.data as FieldRow[] | null) ?? [];
      } else {
        const myFieldsRes = await supabase.rpc('list_accessible_fields_for_operations');
        if (myFieldsRes.error) {
          scopedFields = [];
          setStatusMessage('No fue posible resolver canchas asignadas. Ejecuta el hotfix de politicas de eventos para visibilidad por cancha.');
        } else {
          scopedFields = (myFieldsRes.data as FieldRow[] | null) ?? [];
        }
      }

      const scopedFieldIds = scopedFields.map((item) => item.id);

      if (!canMaintainAdmins && scopedFieldIds.length === 0) {
        setFields([]);
        setEvents([]);
        setActiveEventId('');
        return;
      }

      let eventsResExtendedQuery = supabase
        .from('events')
        .select('id,title,event_date,starts_at,ends_at,scheduled_at,max_players,registration_closed_at,field_id,created_at')
        .order('created_at', { ascending: false })
        .limit(120);

      if (!canMaintainAdmins && scopedFieldIds.length > 0) {
        eventsResExtendedQuery = eventsResExtendedQuery.in('field_id', scopedFieldIds);
      }

      const eventsResExtended = await eventsResExtendedQuery;

      let eventsRes: {
        data: EventRow[] | null;
        error: { message?: string } | null;
      } = {
        data: (eventsResExtended.data as EventRow[] | null) ?? null,
        error: eventsResExtended.error as { message?: string } | null
      };

      if (eventsRes.error) {
        const message = (eventsRes.error.message ?? '').toLowerCase();
        if (
          message.includes('scheduled_at')
          || message.includes('max_players')
          || message.includes('registration_closed_at')
        ) {
          const eventsResFallback = await supabase
            .from('events')
            .select('id,title,event_date,starts_at,ends_at,field_id,created_at')
            .order('created_at', { ascending: false })
            .limit(120);

          eventsRes = {
            data: (eventsResFallback.data as EventRow[] | null) ?? null,
            error: eventsResFallback.error as { message?: string } | null
          };

          if (!eventsRes.error && !canMaintainAdmins && scopedFieldIds.length > 0) {
            const filteredData = ((eventsRes.data as EventRow[] | null) ?? []).filter((item) => scopedFieldIds.includes(item.field_id));
            eventsRes = {
              data: filteredData,
              error: null
            };
          }
        }
      }
      if (eventsRes.error) throw eventsRes.error;

      const nextFields = scopedFields;
      const nextEvents = (eventsRes.data as EventRow[] | null) ?? [];

      setFields(nextFields);
      setEvents(nextEvents);

      if (nextFields.length > 0) {
        setEventFieldId((prev) => prev || nextFields[0].id);
        if (canMaintainAdmins) {
          setAdminFieldId((prev) => prev || nextFields[0].id);
        }
      }

      setActiveEventId(nextEvents[0]?.id ?? '');
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadFieldAdminsByField(fieldId: string) {
    if (!supabase || !fieldId) {
      return;
    }

    setFieldAdminBusy(true);
    try {
      const { data, error } = await supabase.rpc('list_field_admins_for_field', {
        p_field_id: fieldId
      });

      if (error) throw error;
      setFieldAdmins((data as FieldAdminRow[] | null) ?? []);
    } catch (error) {
      setFieldAdmins([]);
      setStatusMessage(mapError(error));
    } finally {
      setFieldAdminBusy(false);
    }
  }

  async function handleAssignFieldAdminByEmail() {
    if (!supabase) {
      return;
    }

    if (!adminFieldId) {
      setStatusMessage('Selecciona una cancha para asignar admin.');
      return;
    }

    const nextEmail = fieldAdminEmailInput.trim().toLowerCase();
    if (!nextEmail) {
      setStatusMessage('Debes indicar un correo para asignar admin de cancha.');
      return;
    }

    setFieldAdminBusy(true);
    try {
      const { data, error } = await supabase.rpc('set_field_admin_by_email', {
        p_field_id: adminFieldId,
        p_user_email: nextEmail,
        p_enabled: true
      });

      if (error) throw error;

      const status = String((data as { status?: string } | null)?.status ?? 'assigned');
      setFieldAdminEmailInput('');
      setStatusMessage(
        status === 'already_assigned'
          ? `El correo ${nextEmail} ya era admin en esta cancha.`
          : `Admin de cancha asignado a ${nextEmail}.`
      );
      await loadFieldAdminsByField(adminFieldId);
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setFieldAdminBusy(false);
    }
  }

  async function handleRevokeFieldAdminByEmail(email: string) {
    if (!supabase || !adminFieldId) {
      return;
    }

    setFieldAdminBusy(true);
    try {
      const { data, error } = await supabase.rpc('set_field_admin_by_email', {
        p_field_id: adminFieldId,
        p_user_email: email,
        p_enabled: false
      });

      if (error) throw error;

      const status = String((data as { status?: string } | null)?.status ?? 'revoked');
      setStatusMessage(
        status === 'not_assigned'
          ? `El correo ${email} no estaba asignado en esta cancha.`
          : `Acceso de admin de cancha revocado para ${email}.`
      );
      await loadFieldAdminsByField(adminFieldId);
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setFieldAdminBusy(false);
    }
  }

  async function fetchMetricMap(operatorIds: string[]): Promise<Map<string, PlayerMetrics>> {
    const metricMap = new Map<string, PlayerMetrics>();
    if (!supabase || operatorIds.length === 0) {
      return metricMap;
    }

    const uniqueIds = Array.from(new Set(operatorIds));

    try {
      const { data, error } = await supabase
        .from('operator_metric_scores')
        .select(
          'operator_user_id,total_confirmed_events,total_fair_play_green,total_fair_play_yellow,total_fair_play_red,total_matches_participated,total_matches_won,total_matches_lost,total_field_time_seconds'
        )
        .in('operator_user_id', uniqueIds);

      if (error) throw error;

      ((data as MetricRowRaw[] | null) ?? []).forEach((row) => {
        metricMap.set(row.operator_user_id, {
          total_confirmed_events: Number(row.total_confirmed_events ?? 0),
          total_fair_play_green: Number(row.total_fair_play_green ?? 0),
          total_fair_play_yellow: Number(row.total_fair_play_yellow ?? 0),
          total_fair_play_red: Number(row.total_fair_play_red ?? 0),
          total_matches_participated: Number(row.total_matches_participated ?? 0),
          total_matches_won: Number(row.total_matches_won ?? 0),
          total_matches_lost: Number(row.total_matches_lost ?? 0),
          total_field_time_seconds: Number(row.total_field_time_seconds ?? 0)
        });
      });
    } catch {
      uniqueIds.forEach((operatorId) => metricMap.set(operatorId, defaultMetrics()));
    }

    uniqueIds.forEach((operatorId) => {
      if (!metricMap.has(operatorId)) {
        metricMap.set(operatorId, defaultMetrics());
      }
    });

    return metricMap;
  }

  async function loadEventData(eventId: string) {
    if (!supabase) {
      return;
    }

    setBusy(true);
    try {
      const [checkinsRes, guestPlayersRes, assignmentsRes, guestAssignmentsRes, matchesRes, cardsRes, guestCardsRes, paidRegistrationsRes] = await Promise.all([
        supabase.from('event_checkins').select('operator_user_id').eq('event_id', eventId),
        supabase
          .from('event_guest_players')
          .select('id,nickname,rut,blood_group,team_hint,is_minor,note')
          .eq('event_id', eventId)
          .order('created_at', { ascending: true }),
        supabase
          .from('event_team_assignments')
          .select('operator_user_id,team_slot,day_role,assignment_note,is_active')
          .eq('event_id', eventId),
        supabase
          .from('event_guest_team_assignments')
          .select('guest_player_id,team_slot,day_role,assignment_note,is_active')
          .eq('event_id', eventId),
        supabase
          .from('event_matches')
          .select('id,title,status,starts_at,ends_at,duration_seconds,winner_team,paused_at,total_paused_seconds,created_at')
          .eq('event_id', eventId)
          .order('created_at', { ascending: false }),
        supabase
          .from('conduct_cards')
          .select('id,operator_user_id,card_type,detail,issued_at')
          .eq('event_id', eventId)
          .order('issued_at', { ascending: false })
          .limit(400),
        supabase
          .from('event_guest_conduct_cards')
          .select('id,guest_player_id,card_type,detail,issued_at')
          .eq('event_id', eventId)
          .order('issued_at', { ascending: false })
          .limit(400),
        supabase
          .from('event_paid_registrations')
          .select('id,event_id,payment_order_id,operator_user_id,guest_nickname,guest_rut_normalized,guest_blood_group,is_minor,registration_status,team_slot,checked_in_at,assigned_at,metadata')
          .eq('event_id', eventId)
          .order('created_at', { ascending: false })
          .limit(200)
      ]);

      if (checkinsRes.error) throw checkinsRes.error;
      if (guestPlayersRes.error) throw guestPlayersRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;
      if (guestAssignmentsRes.error) throw guestAssignmentsRes.error;
      if (matchesRes.error) throw matchesRes.error;
      if (cardsRes.error) throw cardsRes.error;
      if (guestCardsRes.error) throw guestCardsRes.error;
      if (paidRegistrationsRes.error) throw paidRegistrationsRes.error;

      const checkins = (checkinsRes.data as Array<{ operator_user_id: string }> | null) ?? [];
      const guestPlayers = (guestPlayersRes.data as GuestPlayerRow[] | null) ?? [];
      const assignments = (assignmentsRes.data as AssignmentRow[] | null) ?? [];
      const guestAssignments = (guestAssignmentsRes.data as GuestAssignmentRow[] | null) ?? [];
      const nextMatches = (matchesRes.data as MatchRow[] | null) ?? [];
      const operatorCards = (cardsRes.data as OperatorCardRow[] | null) ?? [];
      const guestCards = (guestCardsRes.data as GuestCardRow[] | null) ?? [];
      const paidRows = (paidRegistrationsRes.data as PaidRegistrationRow[] | null) ?? [];

      const operatorIds = checkins.map((row) => row.operator_user_id);

      if (operatorIds.length === 0 && guestPlayers.length === 0) {
        setPlayers([]);
        setMatches(nextMatches);
        setCards([]);
        setPaidRegistrations(paidRows);
        setMissingTables(false);
        return;
      }

      const [profilesRes, metricsMap] = await Promise.all([
        operatorIds.length > 0
          ? supabase
            .from('operator_profiles')
            .select('user_id,nickname,operator_role,blood_group,team')
            .in('user_id', operatorIds)
          : Promise.resolve({ data: [], error: null }),
        fetchMetricMap(operatorIds)
      ]);

      if (profilesRes.error) throw profilesRes.error;

      const profiles = (profilesRes.data as Array<{
        user_id: string;
        nickname: string;
        operator_role: string;
        blood_group: string;
        team: string | null;
      }> | null) ?? [];

      const assignmentMap = new Map(assignments.map((item) => [item.operator_user_id, item]));
      const guestAssignmentMap = new Map(guestAssignments.map((item) => [item.guest_player_id, item]));
      const cardCountMap = new Map<string, number>();
      const mergedCards: CardRow[] = [
        ...operatorCards.map((card) => ({
          id: card.id,
          playerKey: toPlayerKey('operator', card.operator_user_id),
          playerId: card.operator_user_id,
          kind: 'operator' as const,
          card_type: card.card_type,
          detail: card.detail,
          issued_at: card.issued_at
        })),
        ...guestCards.map((card) => ({
          id: card.id,
          playerKey: toPlayerKey('guest', card.guest_player_id),
          playerId: card.guest_player_id,
          kind: 'guest' as const,
          card_type: card.card_type,
          detail: card.detail,
          issued_at: card.issued_at
        }))
      ];

      mergedCards.forEach((card) => {
        const current = cardCountMap.get(card.playerKey) ?? 0;
        cardCountMap.set(card.playerKey, current + 1);
      });

      const roster: RosterPlayer[] = [
        ...profiles.map((profile) => {
          const assignment = assignmentMap.get(profile.user_id);
          const playerKey = toPlayerKey('operator', profile.user_id);

          return {
            kind: 'operator' as const,
            userId: playerKey,
            entityId: profile.user_id,
            operatorUserId: profile.user_id,
            nickname: profile.nickname,
            role: profile.operator_role,
            bloodGroup: profile.blood_group,
            teamHint: profile.team ?? undefined,
            teamSlot: assignment?.team_slot ?? 'reserve',
            dayRole: assignment?.day_role?.trim() ?? '',
            assignmentNote: assignment?.assignment_note?.trim() ?? '',
            isActiveInEvent: assignment?.is_active ?? true,
            isMinor: false,
            metrics: metricsMap.get(profile.user_id) ?? defaultMetrics(),
            cardsInEvent: cardCountMap.get(playerKey) ?? 0
          };
        }),
        ...guestPlayers.map((guest) => {
          const assignment = guestAssignmentMap.get(guest.id);
          const playerKey = toPlayerKey('guest', guest.id);

          return {
            kind: 'guest' as const,
            userId: playerKey,
            entityId: guest.id,
            guestPlayerId: guest.id,
            nickname: guest.nickname,
            role: guest.is_minor ? 'Menor invitado' : 'Invitado sin historial',
            bloodGroup: guest.blood_group?.trim() || 'N/D',
            teamHint: guest.team_hint ?? undefined,
            teamSlot: assignment?.team_slot ?? 'reserve',
            dayRole: assignment?.day_role?.trim() ?? '',
            assignmentNote: assignment?.assignment_note?.trim() ?? guest.note?.trim() ?? '',
            isActiveInEvent: assignment?.is_active ?? true,
            isMinor: guest.is_minor,
            metrics: defaultMetrics(),
            cardsInEvent: cardCountMap.get(playerKey) ?? 0
          };
        })
      ];

      setPlayers(roster.sort((a, b) => a.nickname.localeCompare(b.nickname)));
      setMatches(nextMatches);
      setCards(mergedCards);
      setPaidRegistrations(paidRows);
      setMissingTables(false);
    } catch (error) {
      const message = mapError(error);
      setStatusMessage(message);
      if (
        message.includes('does not exist')
        || message.includes('schema cache')
        || message.includes('paused_at')
        || message.includes('event_guest_')
        || message.includes('event_paid_registrations')
      ) {
        setMissingTables(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    if (!eventFieldId || !eventTitle.trim()) {
      setStatusMessage('Debes indicar cancha y nombre del evento.');
      return;
    }

    setBusy(true);
    try {
      const scheduledAt = toIsoDateTime(eventDate, eventTime);
      const parsedMaxPlayers = Number(eventMaxPlayers);
      const maxPlayersValue = Number.isFinite(parsedMaxPlayers) && parsedMaxPlayers > 0
        ? Math.floor(parsedMaxPlayers)
        : null;

      let createRes = await supabase
        .from('events')
        .insert({
          field_id: eventFieldId,
          title: eventTitle.trim(),
          event_date: eventDate,
          scheduled_at: scheduledAt,
          max_players: maxPlayersValue,
          created_by: sessionUserId
        })
        .select('id,title,event_date,starts_at,ends_at,scheduled_at,max_players,registration_closed_at,field_id,created_at')
        .single();

      if (createRes.error) {
        const message = createRes.error.message.toLowerCase();
        if (message.includes('scheduled_at') || message.includes('max_players')) {
          createRes = await supabase
            .from('events')
            .insert({
              field_id: eventFieldId,
              title: eventTitle.trim(),
              event_date: eventDate,
              created_by: sessionUserId
            })
            .select('id,title,event_date,starts_at,ends_at,field_id,created_at')
            .single();
        }
      }

      const { data, error } = createRes;

      if (error) throw error;

      const nextEvent = data as EventRow;
      setEvents((prev) => [nextEvent, ...prev]);
      setActiveEventId(nextEvent.id);
      setStatusMessage(`Evento ${nextEvent.title} creado. Continua con el cierre de inscripciones cuando corresponda.`);
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateActiveEvent() {
    if (!supabase || !activeEventId || !activeEvent) {
      return;
    }

    const parsedMaxPlayers = Number(eventEditMaxPlayers);
    const maxPlayersValue = Number.isFinite(parsedMaxPlayers) && parsedMaxPlayers > 0
      ? Math.floor(parsedMaxPlayers)
      : null;
    const scheduledAt = toIsoDateTime(eventEditDate || activeEvent.event_date, eventEditTime);

    setBusy(true);
    try {
      let updateRes = await supabase
        .from('events')
        .update({
          title: eventEditTitle.trim() || activeEvent.title,
          event_date: eventEditDate || activeEvent.event_date,
          scheduled_at: scheduledAt,
          max_players: maxPlayersValue
        })
        .eq('id', activeEventId);

      if (updateRes.error) {
        const message = updateRes.error.message.toLowerCase();
        if (message.includes('scheduled_at') || message.includes('max_players')) {
          updateRes = await supabase
            .from('events')
            .update({
              title: eventEditTitle.trim() || activeEvent.title,
              event_date: eventEditDate || activeEvent.event_date
            })
            .eq('id', activeEventId);
        }
      }

      if (updateRes.error) throw updateRes.error;

      setStatusMessage('Evento actualizado correctamente.');
      await loadInitialData();
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteActiveEvent() {
    if (!supabase || !activeEventId || !activeEvent) {
      return;
    }

    const confirmed = window.confirm(`Eliminar evento ${activeEvent.title}? Esta accion no se puede deshacer.`);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase
        .from('events')
        .delete()
        .eq('id', activeEventId)
        .select('id');
      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error('No se pudo eliminar el evento. Verifica permisos de admin de cancha para esta operacion.');
      }

      setStatusMessage('Evento eliminado.');
      setActiveEventId('');
      await loadInitialData();
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseRegistrations() {
    if (!supabase || !activeEventId || !activeEvent) {
      return;
    }

    if (activeEvent.ends_at) {
      setStatusMessage('El evento ya esta cerrado en forma definitiva.');
      return;
    }

    setBusy(true);
    try {
      let updateRes = await supabase
        .from('events')
        .update({ registration_closed_at: new Date().toISOString() })
        .eq('id', activeEventId);

      if (updateRes.error) {
        const message = updateRes.error.message.toLowerCase();
        if (message.includes('registration_closed_at')) {
          throw new Error('Falta columna registration_closed_at. Ejecuta migracion de flujo de eventos para cerrar inscripciones.');
        }
      }

      if (updateRes.error) throw updateRes.error;

      setStatusMessage('Inscripciones cerradas. Desde ahora no se permiten nuevos registros de operadores.');
      await loadInitialData();
      await loadEventData(activeEventId);
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseEvent() {
    if (!supabase || !activeEventId || !activeEvent) {
      return;
    }

    setBusy(true);
    try {
      const endedAt = new Date().toISOString();
      let updateRes = await supabase
        .from('events')
        .update({
          registration_closed_at: activeEvent.registration_closed_at ?? endedAt,
          ends_at: endedAt
        })
        .eq('id', activeEventId);

      if (updateRes.error) {
        const message = updateRes.error.message.toLowerCase();
        if (message.includes('registration_closed_at')) {
          updateRes = await supabase
            .from('events')
            .update({ ends_at: endedAt })
            .eq('id', activeEventId);
        }
      }

      if (updateRes.error) throw updateRes.error;

      setStatusMessage('Evento cerrado correctamente.');
      await loadInitialData();
      await loadEventData(activeEventId);
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  async function resolveGuestPlayer(normalizedRut: string, fallbackNickname: string): Promise<GuestLookup> {
    if (!supabase || !activeEventId) {
      throw new Error('Debes seleccionar un evento antes de registrar invitados.');
    }

    const guestNickname = buildGuestNickname(normalizedRut, fallbackNickname);

    if (normalizedRut) {
      const { data, error } = await supabase
        .from('event_guest_players')
        .select('id,nickname,blood_group,team_hint,is_minor')
        .eq('event_id', activeEventId)
        .eq('rut', normalizedRut)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const guest = data as {
          id: string;
          nickname: string;
          blood_group: string | null;
          team_hint: string | null;
          is_minor: boolean;
        };

        return {
          kind: 'guest',
          guestPlayerId: guest.id,
          nickname: guest.nickname,
          bloodGroup: guest.blood_group?.trim() || 'N/D',
          teamHint: guest.team_hint ?? undefined,
          isMinor: guest.is_minor
        };
      }
    }

    const { data: nicknameMatches, error: nicknameError } = await supabase
      .from('event_guest_players')
      .select('id,nickname,blood_group,team_hint,is_minor')
      .eq('event_id', activeEventId)
      .eq('nickname', guestNickname)
      .limit(1);

    if (nicknameError) throw nicknameError;

    if (nicknameMatches && nicknameMatches[0]) {
      const guest = nicknameMatches[0] as {
        id: string;
        nickname: string;
        blood_group: string | null;
        team_hint: string | null;
        is_minor: boolean;
      };

      return {
        kind: 'guest',
        guestPlayerId: guest.id,
        nickname: guest.nickname,
        bloodGroup: guest.blood_group?.trim() || 'N/D',
        teamHint: guest.team_hint ?? undefined,
        isMinor: guest.is_minor
      };
    }

    const { data: insertedGuest, error: guestInsertError } = await supabase
      .from('event_guest_players')
      .insert({
        event_id: activeEventId,
        nickname: guestNickname,
        rut: normalizedRut || null,
        is_minor: guestIsMinor,
        note: guestIsMinor ? 'Jugador menor de edad sin perfil registrado.' : 'Jugador invitado sin historial.',
        registered_by: sessionUserId
      })
      .select('id,nickname,blood_group,team_hint,is_minor')
      .single();

    if (guestInsertError) throw guestInsertError;

    return {
      kind: 'guest',
      guestPlayerId: insertedGuest.id,
      nickname: insertedGuest.nickname,
      bloodGroup: insertedGuest.blood_group?.trim() || 'N/D',
      teamHint: insertedGuest.team_hint ?? undefined,
      isMinor: insertedGuest.is_minor
    };
  }

  async function resolveGuestFromPaidRegistration(registration: PaidRegistrationRow): Promise<GuestLookup> {
    if (!supabase || !activeEventId) {
      throw new Error('Debes seleccionar un evento antes de registrar invitados de pago.');
    }

    const normalizedRut = normalizeRut(registration.guest_rut_normalized ?? '');
    const fallbackNickname = registration.guest_nickname?.trim() || 'Invitado pagado';

    if (normalizedRut) {
      const { data, error } = await supabase
        .from('event_guest_players')
        .select('id,nickname,blood_group,team_hint,is_minor')
        .eq('event_id', activeEventId)
        .eq('rut', normalizedRut)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        return {
          kind: 'guest',
          guestPlayerId: data.id,
          nickname: data.nickname,
          bloodGroup: data.blood_group?.trim() || 'N/D',
          teamHint: data.team_hint ?? undefined,
          isMinor: data.is_minor
        };
      }
    }

    const { data: nicknameRows, error: nicknameError } = await supabase
      .from('event_guest_players')
      .select('id,nickname,blood_group,team_hint,is_minor')
      .eq('event_id', activeEventId)
      .eq('nickname', fallbackNickname)
      .limit(1);

    if (nicknameError) throw nicknameError;

    if (nicknameRows && nicknameRows[0]) {
      const guest = nicknameRows[0] as {
        id: string;
        nickname: string;
        blood_group: string | null;
        team_hint: string | null;
        is_minor: boolean;
      };

      return {
        kind: 'guest',
        guestPlayerId: guest.id,
        nickname: guest.nickname,
        bloodGroup: guest.blood_group?.trim() || 'N/D',
        teamHint: guest.team_hint ?? undefined,
        isMinor: guest.is_minor
      };
    }

    const { data: insertedGuest, error: insertError } = await supabase
      .from('event_guest_players')
      .insert({
        event_id: activeEventId,
        nickname: fallbackNickname,
        rut: normalizedRut || null,
        blood_group: registration.guest_blood_group || null,
        is_minor: registration.is_minor,
        note: 'Jugador invitado creado desde pago validado.',
        registered_by: sessionUserId
      })
      .select('id,nickname,blood_group,team_hint,is_minor')
      .single();

    if (insertError) throw insertError;

    return {
      kind: 'guest',
      guestPlayerId: insertedGuest.id,
      nickname: insertedGuest.nickname,
      bloodGroup: insertedGuest.blood_group?.trim() || 'N/D',
      teamHint: insertedGuest.team_hint ?? undefined,
      isMinor: insertedGuest.is_minor
    };
  }

  async function ensurePaidRegistrationPresent(registration: PaidRegistrationRow): Promise<{ kind: PlayerKind; operatorUserId?: string; guestPlayerId?: string }> {
    if (!supabase || !activeEventId) {
      throw new Error('Debes seleccionar un evento activo.');
    }

    if (registration.operator_user_id) {
      const { error: checkinError } = await supabase
        .from('event_checkins')
        .upsert(
          {
            event_id: activeEventId,
            operator_user_id: registration.operator_user_id,
            checked_in_by: sessionUserId,
            checkin_source: 'payment_webhook'
          },
          { onConflict: 'event_id,operator_user_id' }
        );

      if (checkinError) throw checkinError;

      if (registration.registration_status === 'paid') {
        const { error: updateError } = await supabase
          .from('event_paid_registrations')
          .update({
            registration_status: 'present',
            checked_in_at: new Date().toISOString()
          })
          .eq('id', registration.id);

        if (updateError) throw updateError;
      }

      return { kind: 'operator', operatorUserId: registration.operator_user_id };
    }

    const guest = await resolveGuestFromPaidRegistration(registration);
    if (registration.registration_status === 'paid') {
      const { error: updateError } = await supabase
        .from('event_paid_registrations')
        .update({
          registration_status: 'present',
          checked_in_at: new Date().toISOString(),
          metadata: {
            ...(registration.metadata ?? {}),
            guest_player_id: guest.guestPlayerId
          }
        })
        .eq('id', registration.id);

      if (updateError) throw updateError;
    }

    return { kind: 'guest', guestPlayerId: guest.guestPlayerId };
  }

  async function handleMarkPaidPresent(registration: PaidRegistrationRow) {
    if (!activeEventId || !supabase) {
      return;
    }

    setBusy(true);
    try {
      await ensurePaidRegistrationPresent(registration);
      setStatusMessage('Inscripcion pagada pasada a presente.');
      await loadEventData(activeEventId);
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignPaidTeam(registration: PaidRegistrationRow, teamSlot: TeamSlot) {
    if (!activeEventId || !supabase) {
      return;
    }

    setBusy(true);
    try {
      const resolved = await ensurePaidRegistrationPresent(registration);
      const assignedAt = new Date().toISOString();

      if (resolved.kind === 'operator' && resolved.operatorUserId) {
        const { error: teamError } = await supabase
          .from('event_team_assignments')
          .upsert(
            {
              event_id: activeEventId,
              operator_user_id: resolved.operatorUserId,
              team_slot: teamSlot,
              assigned_by: sessionUserId
            },
            { onConflict: 'event_id,operator_user_id' }
          );

        if (teamError) throw teamError;
      }

      if (resolved.kind === 'guest' && resolved.guestPlayerId) {
        const { error: teamError } = await supabase
          .from('event_guest_team_assignments')
          .upsert(
            {
              event_id: activeEventId,
              guest_player_id: resolved.guestPlayerId,
              team_slot: teamSlot,
              assigned_by: sessionUserId,
              assignment_note: 'Asignado desde inscripcion pagada.'
            },
            { onConflict: 'event_id,guest_player_id' }
          );

        if (teamError) throw teamError;
      }

      const { error: updateError } = await supabase
        .from('event_paid_registrations')
        .update({
          registration_status: 'assigned',
          team_slot: teamSlot,
          assigned_at: assignedAt,
          checked_in_at: registration.checked_in_at ?? assignedAt
        })
        .eq('id', registration.id);

      if (updateError) throw updateError;

      setStatusMessage(`Inscripcion pagada asignada a ${TEAM_LABEL[teamSlot]}.`);
      await loadEventData(activeEventId);
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  async function resolvePlayerLookup(): Promise<PlayerLookup> {
    if (!supabase) {
      throw new Error('Supabase no disponible.');
    }

    const normalizedRut = normalizeRut(rutInput);
    const playerName = playerNameInput.trim();

    if (!normalizedRut && !playerName) {
      throw new Error('Ingresa al menos nombre o RUT para registrar.');
    }

    if (normalizedRut.length >= 8) {
      const rutRegex = `${normalizedRut.slice(0, -1)}-${normalizedRut.slice(-1)}`;
      const { data: identityRows } = await supabase
        .from('rut_identities')
        .select('user_id,rut')
        .ilike('rut', `%${rutRegex}%`)
        .limit(1);

      if (identityRows && identityRows[0]) {
        const targetId = String((identityRows[0] as { user_id?: string }).user_id ?? '').trim();
        if (targetId && UUID_RE.test(targetId)) {
          const { data: opData, error: opError } = await supabase
            .from('operator_profiles')
            .select('user_id,nickname,operator_role,blood_group,team')
            .eq('user_id', targetId)
            .maybeSingle();

          if (!opError && opData) {
            const operator = opData as {
              user_id: string;
              nickname: string;
              operator_role: string;
              blood_group: string;
              team: string | null;
            };

            return {
              kind: 'operator',
              userId: operator.user_id,
              nickname: operator.nickname,
              role: operator.operator_role,
              bloodGroup: operator.blood_group,
              teamHint: operator.team ?? undefined
            };
          }
        }
      }
    }

    if (playerName) {
      const { data, error } = await supabase
        .from('operator_profiles')
        .select('user_id,nickname,operator_role,blood_group,team')
        .ilike('nickname', playerName)
        .limit(1);

      if (!error && data && data[0]) {
        const operator = data[0] as {
          user_id: string;
          nickname: string;
          operator_role: string;
          blood_group: string;
          team: string | null;
        };

        return {
          kind: 'operator',
          userId: operator.user_id,
          nickname: operator.nickname,
          role: operator.operator_role,
          bloodGroup: operator.blood_group,
          teamHint: operator.team ?? undefined
        };
      }
    }

    if (!allowGuestRegistration) {
      throw new Error('No se encontro operador con los datos entregados. Activa modo invitado para registrarlo sin historial.');
    }

    return resolveGuestPlayer(normalizedRut, playerName);
  }

  async function handleRegisterPlayer() {
    if (!activeEventId || !supabase) {
      return;
    }

    if (registrationLocked) {
      setStatusMessage('Inscripciones cerradas para este evento. No se admiten nuevos operadores.');
      return;
    }

    setLookupBusy(true);
    try {
      const player = await resolvePlayerLookup();

      const inferredTeam: TeamSlot = player.teamHint?.toLowerCase().includes('bravo')
        ? 'bravo'
        : player.teamHint?.toLowerCase().includes('alpha')
          ? 'alpha'
          : 'reserve';

      if (player.kind === 'operator') {
        const { error: checkinError } = await supabase
          .from('event_checkins')
          .upsert(
            {
              event_id: activeEventId,
              operator_user_id: player.userId,
              checked_in_by: sessionUserId,
              checkin_source: rutInput.trim() ? 'rut_lookup' : 'manual'
            },
            { onConflict: 'event_id,operator_user_id' }
          );

        if (checkinError) throw checkinError;

        const { error: teamError } = await supabase
          .from('event_team_assignments')
          .upsert(
            {
              event_id: activeEventId,
              operator_user_id: player.userId,
              team_slot: inferredTeam,
              assigned_by: sessionUserId
            },
            { onConflict: 'event_id,operator_user_id' }
          );

        if (teamError) throw teamError;
      } else {
        const { error: guestTeamError } = await supabase
          .from('event_guest_team_assignments')
          .upsert(
            {
              event_id: activeEventId,
              guest_player_id: player.guestPlayerId,
              team_slot: inferredTeam,
              assigned_by: sessionUserId,
              assignment_note: player.isMinor ? 'Jugador menor de edad sin historial en plataforma.' : 'Jugador invitado sin historial en plataforma.'
            },
            { onConflict: 'event_id,guest_player_id' }
          );

        if (guestTeamError) throw guestTeamError;
      }

      setRutInput('');
      setPlayerNameInput('');
      setAllowGuestRegistration(false);
      setGuestIsMinor(false);
      setStatusMessage(`${player.nickname} registrado en el evento.`);
      await loadEventData(activeEventId);
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setLookupBusy(false);
    }
  }

  async function movePlayerToTeam(operatorUserId: string, teamSlot: TeamSlot) {
    if (!activeEventId || !supabase) {
      return;
    }

    const target = players.find((player) => player.userId === operatorUserId);

    setPlayers((prev) => prev.map((player) => (player.userId === operatorUserId ? { ...player, teamSlot } : player)));

    const assignmentPayload = {
      event_id: activeEventId,
      team_slot: teamSlot,
      day_role: target?.dayRole || null,
      assignment_note: target?.assignmentNote || null,
      is_active: target?.isActiveInEvent ?? true,
      assigned_by: sessionUserId
    };

    const { error } = target?.kind === 'guest'
      ? await supabase
        .from('event_guest_team_assignments')
        .upsert(
          {
            ...assignmentPayload,
            guest_player_id: target.guestPlayerId
          },
          { onConflict: 'event_id,guest_player_id' }
        )
      : await supabase
        .from('event_team_assignments')
        .upsert(
          {
            ...assignmentPayload,
            operator_user_id: target?.operatorUserId
          },
          { onConflict: 'event_id,operator_user_id' }
        );

    if (error) {
      setStatusMessage(mapError(error));
      await loadEventData(activeEventId);
      return;
    }

    setStatusMessage('Asignacion de equipo actualizada.');
  }

  async function saveSelectedPlayerAssignment() {
    if (!activeEventId || !supabase || !selectedPlayer) {
      return;
    }

    const assignmentPayload = {
      event_id: activeEventId,
      team_slot: selectedPlayer.teamSlot,
      day_role: selectedPlayerDayRole.trim() || null,
      assignment_note: selectedPlayerNote.trim() || null,
      is_active: selectedPlayerActive,
      assigned_by: sessionUserId
    };

    const { error } = selectedPlayer.kind === 'guest'
      ? await supabase
        .from('event_guest_team_assignments')
        .upsert(
          {
            ...assignmentPayload,
            guest_player_id: selectedPlayer.guestPlayerId
          },
          { onConflict: 'event_id,guest_player_id' }
        )
      : await supabase
        .from('event_team_assignments')
        .upsert(
          {
            ...assignmentPayload,
            operator_user_id: selectedPlayer.operatorUserId
          },
          { onConflict: 'event_id,operator_user_id' }
        );

    if (error) {
      setStatusMessage(mapError(error));
      return;
    }

    setPlayers((prev) => prev.map((player) => {
      if (player.userId !== selectedPlayer.userId) {
        return player;
      }

      return {
        ...player,
        dayRole: selectedPlayerDayRole.trim(),
        assignmentNote: selectedPlayerNote.trim(),
        isActiveInEvent: selectedPlayerActive
      };
    }));

    setStatusMessage('Ficha del jugador actualizada.');
  }

  function handleDragStart(event: DragEvent<HTMLElement>, operatorUserId: string) {
    event.dataTransfer.setData('text/plain', operatorUserId);
    event.dataTransfer.effectAllowed = 'move';
  }

  async function handleDrop(event: DragEvent<HTMLElement>, teamSlot: TeamSlot) {
    event.preventDefault();
    const operatorUserId = event.dataTransfer.getData('text/plain');
    if (!operatorUserId) {
      return;
    }

    await movePlayerToTeam(operatorUserId, teamSlot);
  }

  async function handleStartMatch() {
    if (!activeEventId || !supabase) {
      return;
    }

    if (activeEvent?.ends_at) {
      setStatusMessage('El evento ya esta cerrado. No se pueden iniciar partidas.');
      return;
    }

    if (runningMatch) {
      setStatusMessage('Ya existe una partida activa.');
      return;
    }

    if (teamBuckets.alpha.length === 0 || teamBuckets.bravo.length === 0) {
      setStatusMessage('Necesitas jugadores en Alpha y Bravo para iniciar.');
      return;
    }

    setBusy(true);
    try {
      const startsAt = new Date().toISOString();
      const label = matchLabel.trim() || `Ronda ${matches.length + 1}`;

      const { data, error } = await supabase
        .from('event_matches')
        .insert({
          event_id: activeEventId,
          title: label,
          status: 'running',
          starts_at: startsAt,
          paused_at: null,
          total_paused_seconds: 0,
          created_by: sessionUserId
        })
        .select('id,title,status,starts_at,ends_at,duration_seconds,winner_team,paused_at,total_paused_seconds,created_at')
        .single();

      if (error) throw error;

      const match = data as MatchRow;
      const operatorParticipantsPayload = players
        .filter((player) => player.kind === 'operator')
        .filter((player) => player.teamSlot !== 'reserve')
        .map((player) => ({
          match_id: match.id,
          event_id: activeEventId,
          operator_user_id: player.operatorUserId,
          team_slot: player.teamSlot,
          joined_at: startsAt
        }));

      const guestParticipantsPayload = players
        .filter((player) => player.kind === 'guest')
        .filter((player) => player.teamSlot !== 'reserve')
        .map((player) => ({
          match_id: match.id,
          event_id: activeEventId,
          guest_player_id: player.guestPlayerId,
          team_slot: player.teamSlot,
          joined_at: startsAt
        }));

      if (operatorParticipantsPayload.length > 0) {
        const { error: participantError } = await supabase.from('event_match_participants').insert(operatorParticipantsPayload);
        if (participantError) throw participantError;
      }

      if (guestParticipantsPayload.length > 0) {
        const { error: guestParticipantError } = await supabase.from('event_guest_match_participants').insert(guestParticipantsPayload);
        if (guestParticipantError) throw guestParticipantError;
      }

      if (activeEvent?.starts_at === null) {
        await supabase.from('events').update({ starts_at: startsAt }).eq('id', activeEventId);
      }

      setStatusMessage('Partida iniciada.');
      await loadEventData(activeEventId);
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handlePauseMatch() {
    if (!runningMatch || !supabase) {
      return;
    }

    if (runningMatch.paused_at) {
      setStatusMessage('La partida ya esta pausada.');
      return;
    }

    const { error } = await supabase
      .from('event_matches')
      .update({ paused_at: new Date().toISOString() })
      .eq('id', runningMatch.id)
      .eq('status', 'running');

    if (error) {
      setStatusMessage(mapError(error));
      return;
    }

    setStatusMessage('Partida pausada.');
    await loadEventData(activeEventId);
  }

  async function handleResumeMatch() {
    if (!runningMatch || !supabase || !runningMatch.paused_at) {
      return;
    }

    const pausedStart = new Date(runningMatch.paused_at).getTime();
    const resumedAt = Date.now();
    const pausedElapsed = Math.max(0, Math.round((resumedAt - pausedStart) / 1000));
    const totalPaused = Math.max(0, Number(runningMatch.total_paused_seconds ?? 0)) + pausedElapsed;

    const { error } = await supabase
      .from('event_matches')
      .update({ paused_at: null, total_paused_seconds: totalPaused })
      .eq('id', runningMatch.id)
      .eq('status', 'running');

    if (error) {
      setStatusMessage(mapError(error));
      return;
    }

    setStatusMessage('Partida reanudada.');
    await loadEventData(activeEventId);
  }

  async function handleFinishMatch() {
    if (!runningMatch || !supabase || !activeEventId) {
      return;
    }

    setBusy(true);
    try {
      const endedAt = new Date().toISOString();
      const startMs = runningMatch.starts_at ? new Date(runningMatch.starts_at).getTime() : Date.now();
      const pausedCarry = Math.max(0, Number(runningMatch.total_paused_seconds ?? 0));
      const pausedLive = runningMatch.paused_at
        ? Math.max(0, Math.round((Date.now() - new Date(runningMatch.paused_at).getTime()) / 1000))
        : 0;
      const totalPaused = pausedCarry + pausedLive;
      const durationSeconds = Math.max(0, Math.round((Date.now() - startMs) / 1000) - totalPaused);

      const { error } = await supabase
        .from('event_matches')
        .update({
          status: 'finished',
          ends_at: endedAt,
          winner_team: winnerTeam,
          duration_seconds: durationSeconds,
          paused_at: null,
          total_paused_seconds: totalPaused
        })
        .eq('id', runningMatch.id)
        .eq('status', 'running');

      if (error) throw error;

      setStatusMessage(`Partida cerrada. Ganador ${TEAM_LABEL[winnerTeam]}. Continua con tarjetas y cierre final del evento.`);
      await loadEventData(activeEventId);
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleIssueCard(cardType: CardType, targetPlayerId?: string) {
    if (!supabase || !activeEventId) {
      return;
    }

    const playerId = targetPlayerId ?? selectedPlayerId;
    if (!playerId || !quickCardDetail.trim()) {
      setStatusMessage('Selecciona jugador y escribe detalle de tarjeta.');
      return;
    }

    setBusy(true);
    try {
      const targetPlayer = players.find((player) => player.userId === playerId) ?? null;

      const { error } = targetPlayer?.kind === 'guest'
        ? await supabase.from('event_guest_conduct_cards').insert({
          event_id: activeEventId,
          match_id: runningMatch?.id ?? null,
          guest_player_id: targetPlayer.guestPlayerId,
          card_type: cardType,
          detail: quickCardDetail.trim(),
          issued_by: sessionUserId,
          issued_at: new Date().toISOString()
        })
        : await supabase.from('conduct_cards').insert({
          event_id: activeEventId,
          match_id: runningMatch?.id ?? null,
          operator_user_id: targetPlayer?.operatorUserId ?? playerId,
          card_type: cardType,
          detail: quickCardDetail.trim(),
          issued_by: sessionUserId,
          issued_at: new Date().toISOString()
        });

      if (error) throw error;

      setQuickCardDetail('');
      setStatusMessage(`Tarjeta ${cardType.toUpperCase()} registrada.`);
      await loadEventData(activeEventId);
    } catch (error) {
      setStatusMessage(mapError(error));
    } finally {
      setBusy(false);
    }
  }

  function startCardEdit(card: CardRow) {
    setCardEditorId(card.id);
    setCardEditorType(card.card_type);
    setCardEditorDetail(card.detail);
  }

  async function saveCardEdit() {
    if (!supabase || !cardEditorId || !cardEditorDetail.trim()) {
      return;
    }

    const card = cards.find((item) => item.id === cardEditorId) ?? null;

    const { error } = card?.kind === 'guest'
      ? await supabase
        .from('event_guest_conduct_cards')
        .update({
          card_type: cardEditorType,
          detail: cardEditorDetail.trim()
        })
        .eq('id', cardEditorId)
      : await supabase
        .from('conduct_cards')
        .update({
          card_type: cardEditorType,
          detail: cardEditorDetail.trim()
        })
        .eq('id', cardEditorId);

    if (error) {
      setStatusMessage(mapError(error));
      return;
    }

    setCardEditorId('');
    setCardEditorDetail('');
    setStatusMessage('Tarjeta actualizada.');
    await loadEventData(activeEventId);
  }

  async function deleteCard(cardId: string) {
    if (!supabase) {
      return;
    }

    const card = cards.find((item) => item.id === cardId) ?? null;

    const { error } = card?.kind === 'guest'
      ? await supabase.from('event_guest_conduct_cards').delete().eq('id', cardId)
      : await supabase.from('conduct_cards').delete().eq('id', cardId);

    if (error) {
      setStatusMessage(mapError(error));
      return;
    }

    if (cardEditorId === cardId) {
      setCardEditorId('');
      setCardEditorDetail('');
    }

    setStatusMessage('Tarjeta eliminada.');
    await loadEventData(activeEventId);
  }

  if (!hasSupabaseConfig || !supabase) {
    return (
      <section className="ops-shell">
        <h2 className="ops-title">Operaciones de Cancha</h2>
        <p className="ops-status">Configura Supabase para habilitar eventos, partidas y metricas reales.</p>
      </section>
    );
  }

  return (
    <section className="ops-shell" aria-label="Consola de operaciones de cancha">
      <header className="ops-header">
        <div>
          <p className="ops-kicker">CONTROL DE CANCHA</p>
          <h2 className="ops-title">Centro de Operaciones</h2>
          <p className="ops-subtitle">
            Secciones separadas para crear evento, armar equipos, operar partidas y auditar tarjetas.
          </p>
        </div>
        <div className="ops-chip-stack">
          <p className="ops-chip">Admin {operatorNickname || 'cancha'}</p>
          {operatorCredentialId ? <p className="ops-chip">ID {operatorCredentialId}</p> : null}
          <p className="ops-chip">Tiempo evento {toMinutesLabel(eventDurationSeconds)}</p>
        </div>
      </header>

      {missingTables ? (
        <p className="ops-status ops-status-alert">
          Faltan columnas/tablas de operaciones avanzadas. Ejecuta db/supabase_match_ops_metrics.sql, db/supabase_rls_helpers_hotfix.sql y db/supabase_guest_event_players.sql, luego recarga.
        </p>
      ) : null}

      {availableViews.length > 1 ? (
        <nav className="ops-view-tabs" aria-label="Secciones operaciones">
          {availableViews.map((view) => (
            <button
              key={view}
              type="button"
              className={`ops-view-tab ${activeView === view ? 'is-active' : ''}`}
              onClick={() => setActiveView(view)}
            >
              {view.toUpperCase()}
            </button>
          ))}
        </nav>
      ) : null}

      {activeView === 'evento' && (
        <section className="ops-pane" aria-label="Panel evento">
          <div className="ops-pane-head">
            <h3>Evento y Registro</h3>
            <p>Flujo sugerido: crear evento, cerrar inscripciones, operar partida y cerrar evento.</p>
          </div>

          <article className="ops-card">
            <h4>Checklist de proceso</h4>
            <ul className="ops-list">
              <li>{activeEvent ? '1) Evento creado' : '1) Crear evento'}</li>
              <li>{registrationLocked ? '2) Inscripciones cerradas' : '2) Cerrar inscripciones cuando corresponda'}</li>
              <li>{players.length > 0 ? '3) Operadores registrados' : '3) Registrar operadores'}</li>
              <li>{teamBuckets.alpha.length > 0 && teamBuckets.bravo.length > 0 ? '4) Equipos asignados' : '4) Asignar equipos'}</li>
              <li>{matches.some((match) => match.status === 'finished' && match.winner_team) ? '5) Ganador definido' : '5) Definir ganador en cierre de partida'}</li>
              <li>{cards.length > 0 ? '6) Tarjetas aplicadas (si corresponde)' : '6) Aplicar tarjetas de premio/penalizacion'}</li>
              <li>{activeEvent?.ends_at ? '7) Evento cerrado' : '7) Cerrar evento al finalizar'}</li>
            </ul>
          </article>

          <section className="ops-grid ops-grid-top">
            <article className="ops-card">
              <h4>Crear evento</h4>
              <form className="ops-form" onSubmit={handleCreateEvent}>
                <label>
                  Cancha
                  <select value={eventFieldId} onChange={(event) => setEventFieldId(event.target.value)}>
                    {fields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.name}{field.city ? ` (${field.city})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Nombre evento
                  <input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="Milsim Domingo" />
                </label>
                <label>
                  Fecha
                  <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
                </label>
                <label>
                  Hora
                  <input type="time" value={eventTime} onChange={(event) => setEventTime(event.target.value)} />
                </label>
                <label>
                  Cupo jugadores
                  <input
                    type="number"
                    min={1}
                    value={eventMaxPlayers}
                    onChange={(event) => setEventMaxPlayers(event.target.value)}
                    placeholder="40"
                  />
                </label>
                <button type="submit" disabled={busy}>Crear evento</button>
              </form>
            </article>

            <article className="ops-card">
              <h4>Evento activo</h4>
              <div className="ops-event-list" role="listbox" aria-label="Lista de eventos">
                {selectableEvents.map((eventItem) => {
                  const isActive = eventItem.id === activeEventId;
                  return (
                    <button
                      key={eventItem.id}
                      type="button"
                      className={`ops-event-pill ${isActive ? 'is-active' : ''}`}
                      onClick={() => setActiveEventId(eventItem.id)}
                    >
                      <span>{eventItem.title}</span>
                      <span>
                        {eventItem.event_date}
                        {eventItem.ends_at ? ' | cerrado' : ' | abierto'}
                      </span>
                    </button>
                  );
                })}
                {selectableEvents.length === 0 ? <p className="ops-muted">No hay eventos visibles para tus canchas asignadas.</p> : null}
              </div>

              {activeEvent ? (
                <div className="ops-grid" style={{ gap: '8px' }}>
                  <p className="ops-muted">Creado: {new Date(activeEvent.created_at).toLocaleString('es-CL')}</p>
                  <p className="ops-muted">Cierre inscripciones: {activeEvent.registration_closed_at ? new Date(activeEvent.registration_closed_at).toLocaleString('es-CL') : 'abiertas'}</p>
                  <p className="ops-muted">Cierre evento: {activeEvent.ends_at ? new Date(activeEvent.ends_at).toLocaleString('es-CL') : 'pendiente'}</p>

                  <label>
                    Editar nombre
                    <input value={eventEditTitle} onChange={(event) => setEventEditTitle(event.target.value)} />
                  </label>
                  <label>
                    Editar fecha
                    <input type="date" value={eventEditDate} onChange={(event) => setEventEditDate(event.target.value)} />
                  </label>
                  <label>
                    Editar hora
                    <input type="time" value={eventEditTime} onChange={(event) => setEventEditTime(event.target.value)} />
                  </label>
                  <label>
                    Editar cupo
                    <input
                      type="number"
                      min={1}
                      value={eventEditMaxPlayers}
                      onChange={(event) => setEventEditMaxPlayers(event.target.value)}
                    />
                  </label>

                  <div className="ops-inline-actions">
                    <button type="button" disabled={busy} onClick={() => void handleUpdateActiveEvent()}>
                      Guardar evento
                    </button>
                    <button type="button" disabled={busy || registrationLocked} onClick={() => void handleCloseRegistrations()}>
                      Cerrar inscripciones
                    </button>
                    <button type="button" disabled={busy || Boolean(activeEvent.ends_at)} onClick={() => void handleCloseEvent()}>
                      Cerrar evento
                    </button>
                    <button type="button" disabled={busy} onClick={() => void handleDeleteActiveEvent()}>
                      Eliminar
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          </section>

          <section className="ops-grid ops-grid-bottom">
            <article className="ops-card">
              <h4>Registro de jugador</h4>
              <p className="ops-muted">Si no existe perfil, puedes activarlo como invitado o menor sin historial.</p>
              {registrationLocked ? <p className="ops-muted">Inscripciones cerradas: este bloque queda solo en lectura.</p> : null}
              <label>
                Nombre
                <input
                  value={playerNameInput}
                  onChange={(event) => setPlayerNameInput(event.target.value)}
                  placeholder="Ej: Ghost, Valkiria"
                />
              </label>
              <label>
                RUT
                <input
                  value={rutInput}
                  onChange={(event) => setRutInput(event.target.value)}
                  placeholder="12.345.678-5"
                />
              </label>
              <label className="ops-toggle-row">
                <input
                  type="checkbox"
                  checked={allowGuestRegistration}
                  onChange={(event) => setAllowGuestRegistration(event.target.checked)}
                  disabled={registrationLocked}
                />
                <span>Permitir registro como invitado si no existe perfil</span>
              </label>
              <label className="ops-toggle-row">
                <input
                  type="checkbox"
                  checked={guestIsMinor}
                  onChange={(event) => setGuestIsMinor(event.target.checked)}
                  disabled={!allowGuestRegistration || registrationLocked}
                />
                <span>Marcar como menor de edad</span>
              </label>
              <button type="button" onClick={handleRegisterPlayer} disabled={!activeEventId || lookupBusy || registrationLocked}>
                {lookupBusy ? 'Registrando...' : 'Registrar en evento'}
              </button>
            </article>
          </section>

          <section className="ops-grid ops-grid-bottom">
            <article className="ops-card">
              <h4>Pipeline pago a cancha</h4>
              <p className="ops-muted">Flujo operativo: pagado - presente - equipo.</p>
              <ul className="ops-list">
                {paidRegistrations.length === 0 ? <li>No hay inscripciones de pago para este evento.</li> : null}
                {paidRegistrations.map((registration) => {
                  const displayName = registration.operator_user_id
                    ? players.find((player) => player.operatorUserId === registration.operator_user_id)?.nickname || `Operador ${registration.operator_user_id.slice(0, 8)}`
                    : registration.guest_nickname || registration.guest_rut_normalized || 'Invitado pagado';

                  return (
                    <li key={registration.id} className="ops-paid-row">
                      <span>
                        <strong>{displayName}</strong>
                        <small>Estado: {registration.registration_status.toUpperCase()}</small>
                      </span>
                      <div className="ops-inline-actions">
                        <button
                          type="button"
                          disabled={busy || registration.registration_status === 'assigned'}
                          onClick={() => void handleMarkPaidPresent(registration)}
                        >
                          Marcar presente
                        </button>
                        <button
                          type="button"
                          disabled={busy || registration.registration_status === 'assigned'}
                          onClick={() => void handleAssignPaidTeam(registration, 'alpha')}
                        >
                          A Alpha
                        </button>
                        <button
                          type="button"
                          disabled={busy || registration.registration_status === 'assigned'}
                          onClick={() => void handleAssignPaidTeam(registration, 'bravo')}
                        >
                          A Bravo
                        </button>
                        <button
                          type="button"
                          disabled={busy || registration.registration_status === 'assigned'}
                          onClick={() => void handleAssignPaidTeam(registration, 'reserve')}
                        >
                          A Reserva
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </article>
          </section>

        </section>
      )}

      {activeView === 'superadmin' && isHomuraSuperAdmin ? (
        <section className="ops-pane" aria-label="Panel super admin">
          <div className="ops-pane-head">
            <h3>Super Admin</h3>
            <p>Gestion exclusiva de Homura para asignacion de admins de cancha por correo.</p>
          </div>

          <section className="ops-grid ops-grid-bottom">
            <article className="ops-card">
              <h4>Mantenedor admin cancha por correo</h4>

              <label>
                Cancha
                <select value={adminFieldId} onChange={(event) => setAdminFieldId(event.target.value)}>
                  {fields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}{field.city ? ` (${field.city})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Correo del administrador
                <input
                  type="email"
                  autoComplete="email"
                  value={fieldAdminEmailInput}
                  onChange={(event) => setFieldAdminEmailInput(event.target.value)}
                  placeholder="admin@cancha.cl"
                />
              </label>

              <div className="ops-inline-actions">
                <button
                  type="button"
                  onClick={() => void handleAssignFieldAdminByEmail()}
                  disabled={fieldAdminBusy || !adminFieldId}
                >
                  {fieldAdminBusy ? 'Guardando...' : 'Asignar admin'}
                </button>
              </div>

              <ul className="ops-list">
                {fieldAdmins.length === 0 ? <li>No hay admins asignados para esta cancha.</li> : null}
                {fieldAdmins.map((row) => (
                  <li key={`${row.user_id}:${row.assigned_at}`} className="ops-paid-row">
                    <span>
                      <strong>{row.email || row.user_id}</strong>
                      <small>Asignado: {new Date(row.assigned_at).toLocaleString('es-CL')}</small>
                    </span>
                    <div className="ops-inline-actions">
                      <button
                        type="button"
                        disabled={fieldAdminBusy}
                        onClick={() => void handleRevokeFieldAdminByEmail(row.email)}
                      >
                        Revocar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          </section>
        </section>
      ) : null}

      {activeView === 'equipos' && (
        <section className="ops-pane" aria-label="Panel equipos">
          <div className="ops-pane-head">
            <h3>Equipos Drag and Drop</h3>
            <p>Arrastra jugadores entre columnas. Tambien puedes emitir tarjetas al jugador seleccionado.</p>
          </div>

          <section className="ops-team-board">
            {(['alpha', 'reserve', 'bravo'] as TeamSlot[]).map((team) => (
              <article
                key={team}
                className={`ops-team-column is-${team}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  void handleDrop(event, team);
                }}
              >
                <header>
                  <h4>{TEAM_LABEL[team]}</h4>
                  <p>{teamBuckets[team].length} jugadores</p>
                </header>

                <div className="ops-team-list">
                  {teamBuckets[team].map((player) => {
                    const isSelected = player.userId === selectedPlayerId;
                    return (
                      <article
                        key={player.userId}
                        className={`ops-player-card ${isSelected ? 'is-selected' : ''}`}
                        draggable
                        onDragStart={(event) => handleDragStart(event, player.userId)}
                        onClick={() => setSelectedPlayerId(player.userId)}
                      >
                        <p className="ops-player-name">{player.nickname}</p>
                        <p className="ops-player-meta">{player.role} | Sangre {player.bloodGroup}</p>
                        <div className="ops-player-kpis">
                          <span>Part {player.metrics.total_matches_participated}</span>
                          <span>W {player.metrics.total_matches_won}</span>
                          <span>L {player.metrics.total_matches_lost}</span>
                          <span>Cancha {toMinutesLabel(player.metrics.total_field_time_seconds)}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </article>
            ))}
          </section>

          <section className="ops-grid ops-grid-mid">
            <article className="ops-card">
              <h4>Ficha del jugador</h4>
              {selectedPlayer ? (
                <>
                  <p className="ops-muted">{selectedPlayer.nickname}</p>
                  <p className="ops-muted">Equipo actual: {TEAM_LABEL[selectedPlayer.teamSlot]}</p>
                  <p className="ops-muted">Rol base: {selectedPlayer.role}</p>
                  {selectedPlayer.isMinor ? <p className="ops-muted">Marcado como menor de edad.</p> : null}

                  <label>
                    Rol del dia
                    <input
                      value={selectedPlayerDayRole}
                      onChange={(event) => setSelectedPlayerDayRole(event.target.value)}
                      placeholder="Ej: Leader Alpha, Medic 2"
                    />
                  </label>

                  <label>
                    Nota operativa
                    <textarea
                      value={selectedPlayerNote}
                      onChange={(event) => setSelectedPlayerNote(event.target.value)}
                      placeholder="Observaciones, restricciones, etc"
                    />
                  </label>

                  <label className="ops-toggle-row">
                    <input
                      type="checkbox"
                      checked={selectedPlayerActive}
                      onChange={(event) => setSelectedPlayerActive(event.target.checked)}
                    />
                    <span>Activo en esta jornada</span>
                  </label>

                  <div className="ops-inline-actions">
                    <button type="button" onClick={() => void movePlayerToTeam(selectedPlayer.userId, 'alpha')}>A Alpha</button>
                    <button type="button" onClick={() => void movePlayerToTeam(selectedPlayer.userId, 'bravo')}>A Bravo</button>
                    <button type="button" onClick={() => void movePlayerToTeam(selectedPlayer.userId, 'reserve')}>A Reserva</button>
                    <button type="button" onClick={() => void saveSelectedPlayerAssignment()}>Guardar ficha</button>
                  </div>
                </>
              ) : (
                <p className="ops-muted">Haz click en un jugador para acciones rapidas.</p>
              )}
            </article>

            <article className="ops-card">
              <h4>Tarjeta rapida + historial</h4>
              <label>
                Detalle
                <textarea
                  value={quickCardDetail}
                  onChange={(event) => setQuickCardDetail(event.target.value)}
                  placeholder="Motivo de la tarjeta"
                />
              </label>
              <div className="ops-inline-actions ops-card-buttons">
                <button type="button" className="ops-card-green" onClick={() => void handleIssueCard('green')} disabled={!selectedPlayerId || busy}>
                  Verde
                </button>
                <button type="button" className="ops-card-yellow" onClick={() => void handleIssueCard('yellow')} disabled={!selectedPlayerId || busy}>
                  Amarilla
                </button>
                <button type="button" className="ops-card-red" onClick={() => void handleIssueCard('red')} disabled={!selectedPlayerId || busy}>
                  Roja
                </button>
              </div>

              <ul className="ops-list">
                {cards
                  .filter((card) => card.playerKey === selectedPlayerId)
                  .slice(0, 6)
                  .map((card) => (
                    <li key={card.id}>
                      <strong>{card.card_type.toUpperCase()}</strong>
                      <span>{card.detail}</span>
                    </li>
                  ))}
                {selectedPlayerId && cards.filter((card) => card.playerKey === selectedPlayerId).length === 0 ? (
                  <li>Sin tarjetas para este jugador.</li>
                ) : null}
              </ul>
            </article>
          </section>
        </section>
      )}

      {activeView === 'partidas' && (
        <section className="ops-pane" aria-label="Panel partidas">
          <div className="ops-pane-head">
            <h3>Partidas y Cronometro</h3>
            <p>Inicia, pausa, reanuda y cierra partidas. Al cerrar, se guarda ganador y resultado por jugador.</p>
          </div>

          <section className="ops-grid ops-grid-top">
            <article className="ops-card">
              <h4>Control partida</h4>
              <label>
                Nombre ronda
                <input value={matchLabel} onChange={(event) => setMatchLabel(event.target.value)} />
              </label>
              <p className="ops-timer">{elapsedLabel}</p>
              <label>
                Equipo ganador
                <select value={winnerTeam} onChange={(event) => setWinnerTeam(event.target.value as TeamSlot)}>
                  <option value="alpha">{TEAM_LABEL.alpha}</option>
                  <option value="bravo">{TEAM_LABEL.bravo}</option>
                </select>
              </label>
              <div className="ops-inline-actions">
                <button type="button" onClick={() => void handleStartMatch()} disabled={busy || !activeEventId || Boolean(runningMatch)}>
                  Iniciar
                </button>
                <button type="button" onClick={() => void handlePauseMatch()} disabled={busy || !runningMatch || Boolean(runningMatch?.paused_at)}>
                  Pausar
                </button>
                <button type="button" onClick={() => void handleResumeMatch()} disabled={busy || !runningMatch || !runningMatch.paused_at}>
                  Reanudar
                </button>
                <button type="button" onClick={() => void handleFinishMatch()} disabled={busy || !runningMatch}>
                  Cerrar
                </button>
              </div>
            </article>

            <article className="ops-card">
              <h4>Estado actual</h4>
              <p className="ops-muted">Evento: {activeEvent?.title ?? 'Ninguno'}</p>
              <p className="ops-muted">Partida activa: {runningMatch?.title ?? 'No'}</p>
              <p className="ops-muted">Tiempo acumulado evento: {toMinutesLabel(eventDurationSeconds)}</p>
            </article>
          </section>

          <section className="ops-grid ops-grid-bottom">
            <article className="ops-card">
              <h4>Historial de partidas</h4>
              <ul className="ops-list">
                {matches.length ? matches.map((match) => (
                  <li key={match.id}>
                    <strong>{match.title}</strong>
                    <span>{match.status.toUpperCase()}</span>
                    <span>
                      {match.starts_at ? new Date(match.starts_at).toLocaleString('es-CL') : 'Sin inicio'}
                      {' | '}
                      {match.ends_at ? new Date(match.ends_at).toLocaleString('es-CL') : 'Sin termino'}
                    </span>
                    <span>Duracion: {toMinutesLabel(match.duration_seconds ?? 0)}</span>
                    <span>Ganador: {match.winner_team ? TEAM_LABEL[match.winner_team] : 'Pendiente'}</span>
                  </li>
                )) : <li>No hay partidas registradas.</li>}
              </ul>
            </article>
          </section>
        </section>
      )}

      {activeView === 'tarjetas' && (
        <section className="ops-pane" aria-label="Panel tarjetas">
          <div className="ops-pane-head">
            <h3>Tarjetas y Disciplina</h3>
            <p>Resumen completo, edicion y eliminacion de tarjetas asignadas.</p>
          </div>

          <section className="ops-grid ops-grid-top">
            <article className="ops-card">
              <h4>Nueva tarjeta</h4>
              <label>
                Jugador
                <select value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)}>
                  <option value="">Selecciona jugador</option>
                  {players.map((player) => (
                    <option key={player.userId} value={player.userId}>
                      {player.nickname} ({TEAM_LABEL[player.teamSlot]})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Detalle
                <textarea
                  value={quickCardDetail}
                  onChange={(event) => setQuickCardDetail(event.target.value)}
                  placeholder="Describe la conducta"
                />
              </label>
              <div className="ops-inline-actions ops-card-buttons">
                <button type="button" className="ops-card-green" onClick={() => void handleIssueCard('green')} disabled={!selectedPlayerId || busy}>
                  Verde
                </button>
                <button type="button" className="ops-card-yellow" onClick={() => void handleIssueCard('yellow')} disabled={!selectedPlayerId || busy}>
                  Amarilla
                </button>
                <button type="button" className="ops-card-red" onClick={() => void handleIssueCard('red')} disabled={!selectedPlayerId || busy}>
                  Roja
                </button>
              </div>
            </article>

            <article className="ops-card">
              <h4>Resumen por jugador</h4>
              {selectedPlayer ? (
                <>
                  <p className="ops-muted">{selectedPlayer.nickname}</p>
                  <p className="ops-muted">Verdes: {selectedPlayer.metrics.total_fair_play_green}</p>
                  <p className="ops-muted">Amarillas: {selectedPlayer.metrics.total_fair_play_yellow}</p>
                  <p className="ops-muted">Rojas: {selectedPlayer.metrics.total_fair_play_red}</p>
                </>
              ) : (
                <p className="ops-muted">Selecciona jugador para resumen individual.</p>
              )}
            </article>
          </section>

          <section className="ops-grid ops-grid-bottom">
            <article className="ops-card">
              <h4>Historial editable</h4>
              <ul className="ops-list">
                {cards.length ? cards.map((card) => {
                  const player = players.find((item) => item.userId === card.playerKey);
                  const isEditing = cardEditorId === card.id;

                  return (
                    <li key={card.id}>
                      <strong>{player?.nickname ?? card.playerId}</strong>
                      {isEditing ? (
                        <>
                          <select value={cardEditorType} onChange={(event) => setCardEditorType(event.target.value as CardType)}>
                            <option value="green">Verde</option>
                            <option value="yellow">Amarilla</option>
                            <option value="red">Roja</option>
                          </select>
                          <textarea value={cardEditorDetail} onChange={(event) => setCardEditorDetail(event.target.value)} />
                          <div className="ops-inline-actions">
                            <button type="button" onClick={() => void saveCardEdit()} disabled={busy}>Guardar</button>
                            <button type="button" onClick={() => setCardEditorId('')} disabled={busy}>Cancelar</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span>{card.card_type.toUpperCase()} | {card.detail}</span>
                          <span>{new Date(card.issued_at).toLocaleString('es-CL')}</span>
                          <div className="ops-inline-actions">
                            <button type="button" onClick={() => startCardEdit(card)} disabled={busy}>Editar</button>
                            <button type="button" onClick={() => void deleteCard(card.id)} disabled={busy}>Eliminar</button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                }) : <li>No hay tarjetas registradas.</li>}
              </ul>
            </article>
          </section>
        </section>
      )}

      <p className="ops-status" aria-live="polite">{statusMessage}</p>
    </section>
  );
}
