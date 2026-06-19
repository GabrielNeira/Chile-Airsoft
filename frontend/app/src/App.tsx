import { FormEvent, useEffect, useState } from 'react';
import OperatorCredentialCard from './components/OperatorCredentialCard';
import OrganizerScannerView from './components/OrganizerScannerView';
import FieldOperationsConsole from './components/FieldOperationsConsole';
import GodUserMaintainer from './components/GodUserMaintainer';
import GodEventsMaintainer from './components/GodEventsMaintainer';
import GodFieldMaintainer from './components/GodFieldMaintainer';
import OperatorEventMarketplace from './components/OperatorEventMarketplace';
import CheckoutResultView from './components/CheckoutResultView';
import { getOperatorIdMetricsByUserId, getOperatorMetricScoreByUserId } from './lib/operatorMetricsApi';
import { hasSupabaseConfig, supabase } from './lib/supabaseClient';
type AuthMode = 'login' | 'signup';
type AdminOpsWorkspace = 'eventos' | 'proceso' | 'scanner' | 'god';
type GodWorkspace = 'users' | 'events' | 'fields';

interface RegistrationForm {
  nickname: string;
  realName: string;
  rut: string;
  bloodGroup: string;
  team: string;
  operatorRole: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  avatarUrl: string;
}

interface IdentityOnboardingForm {
  rut: string;
  fullName: string;
  acceptPrivacy: boolean;
  acceptTerms: boolean;
  acceptDataProcessing: boolean;
}

interface EditableProfileForm {
  nickname: string;
  realName: string;
  bloodGroup: string;
  team: string;
  operatorRole: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactName2: string;
  emergencyContactPhone2: string;
  allergies: string;
  avatarUrl: string;
  teamLogoUrl: string;
}

interface CredentialOperatorViewModel {
  nickname: string;
  realName: string;
  bloodGroup: string;
  role: string;
  team: string;
  operatorScore: number;
  avatarUrl: string;
  teamLogoUrl?: string;
  qrImageUrl: string;
  iceName: string;
  icePhone: string;
  iceName2?: string;
  icePhone2?: string;
  allergies?: string;
  credentialId: string;
  medals: string[];
  fairPlayScore: number;
  totalFairPlayGreen: number;
  totalFairPlayYellow: number;
  totalFairPlayRed: number;
  confirmedEvents: number;
  achievementsUnlocked: number;
}

interface SupabaseLikeError {
  code?: string;
  message?: string;
}

function sanitizeUiMessage(rawMessage: string): string {
  const lowered = rawMessage.toLowerCase();
  if (lowered.includes('edge function returned a non-2xx status code') || lowered.includes('non-2xx')) {
    return 'No fue posible completar esta operacion por un error del servidor. Intenta nuevamente en unos minutos.';
  }

  return rawMessage;
}

function BrandLogo() {
  const [brandSrc, setBrandSrc] = useState('/logo.png?v=2');

  return (
    <img
      src={brandSrc}
      alt="Logo ID Airsoft Chile"
      className="brand-logo"
      loading="eager"
      decoding="async"
      onError={() => {
        if (brandSrc !== '/logo.svg?v=2') {
          setBrandSrc('/logo.svg?v=2');
        }
      }}
    />
  );
}

function normalizeOperatorScore(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'string' && value.trim().length === 0) {
    return 0;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  if (parsed <= 0) {
    return 0;
  }

  return Math.round(Math.max(1, Math.min(100, parsed)));
}

function resolveOperatorScore(input: {
  directOperatorScore: unknown;
  operatorScoreFromView: unknown;
  fairPlayScore: unknown;
  eventsExperienceScore: unknown;
  achievementsScore: unknown;
}): number {
  const direct = normalizeOperatorScore(input.directOperatorScore);
  if (direct > 0) {
    return direct;
  }

  const fromView = normalizeOperatorScore(input.operatorScoreFromView);
  if (fromView > 0) {
    return fromView;
  }

  const fairPlay = typeof input.fairPlayScore === 'number' ? input.fairPlayScore : Number(input.fairPlayScore);
  const eventsScore =
    typeof input.eventsExperienceScore === 'number'
      ? input.eventsExperienceScore
      : Number(input.eventsExperienceScore);
  const achievements =
    typeof input.achievementsScore === 'number' ? input.achievementsScore : Number(input.achievementsScore);

  const weighted =
    (Number.isFinite(fairPlay) ? fairPlay : 0) * 0.5
    + (Number.isFinite(eventsScore) ? eventsScore : 0) * 0.3
    + (Number.isFinite(achievements) ? achievements : 0) * 0.2;

  return normalizeOperatorScore(weighted);
}

function splitEmergencyPhones(rawPhone: string | null | undefined): { phone1: string; phone2: string } {
  const normalized = (rawPhone ?? '').trim();
  if (!normalized) {
    return { phone1: '', phone2: '' };
  }

  const parts = normalized.split(/\s\|\s/).map((item) => item.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return { phone1: normalized, phone2: '' };
  }

  return {
    phone1: parts[0] ?? '',
    phone2: parts.slice(1).join(' | ')
  };
}

function normalizeRutToken(rawRut: string): string {
  return rawRut.toUpperCase().replace(/[^0-9K]/g, '');
}

function formatRutInput(rawRut: string): string {
  const token = normalizeRutToken(rawRut);
  if (!token) {
    return '';
  }

  if (token.length === 1) {
    return token;
  }

  const body = token.slice(0, -1);
  const dv = token.slice(-1);
  const bodyWithDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${bodyWithDots}-${dv}`;
}

function isValidRutValue(rawRut: string): boolean {
  const token = normalizeRutToken(rawRut);
  if (!/^[0-9]{7,8}[0-9K]$/.test(token)) {
    return false;
  }

  const body = token.slice(0, -1);
  const dv = token.slice(-1);
  let sum = 0;
  let factor = 2;

  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return dv === expected;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ParsedQrPayload {
  userId?: string;
  token?: string;
  nickname?: string;
}

function parseQrPayload(rawQr: string): ParsedQrPayload {
  const trimmed = rawQr.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const userId = String(parsed.userId ?? parsed.operatorUserId ?? parsed.id ?? '').trim();
      const token = String(parsed.token ?? parsed.credential ?? parsed.uniqueQrToken ?? '').trim();
      const nickname = String(parsed.nickname ?? parsed.handle ?? '').trim();
      return {
        userId: userId || undefined,
        token: token || undefined,
        nickname: nickname || undefined
      };
    } catch {
      return { token: trimmed };
    }
  }

  const chunks = trimmed.split('|').map((chunk) => chunk.trim()).filter(Boolean);
  if (chunks.length >= 2) {
    return {
      userId: chunks[0] || undefined,
      nickname: chunks[1] || undefined,
      token: chunks[2] || undefined
    };
  }

  return { token: trimmed };
}

function App() {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/checkout/')) {
    return <CheckoutResultView />;
  }

  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [sessionUserEmail, setSessionUserEmail] = useState<string | null>(null);
  const [sessionRutHint, setSessionRutHint] = useState<string | null>(null);
  const [sessionNameHint, setSessionNameHint] = useState<string | null>(null);
  const [identityRut, setIdentityRut] = useState<string | null>(null);
  const [identityFullName, setIdentityFullName] = useState<string | null>(null);
  const [needsIdentityOnboarding, setNeedsIdentityOnboarding] = useState(false);
  const [needsRegistration, setNeedsRegistration] = useState(false);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [identityOnboardingLoading, setIdentityOnboardingLoading] = useState(false);
  const [identityOnboardingError, setIdentityOnboardingError] = useState<string | null>(null);
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editHint, setEditHint] = useState<string | null>(null);
  const [profileReloadTick, setProfileReloadTick] = useState(0);

  const [registrationForm, setRegistrationForm] = useState<RegistrationForm>({
    nickname: '',
    realName: '',
    rut: '',
    bloodGroup: 'O+',
    team: '',
    operatorRole: 'assault',
    emergencyContactName: '',
    emergencyContactPhone: '',
    avatarUrl: ''
  });
  const [identityOnboardingForm, setIdentityOnboardingForm] = useState<IdentityOnboardingForm>({
    rut: '',
    fullName: '',
    acceptPrivacy: false,
    acceptTerms: false,
    acceptDataProcessing: false
  });
  const [editTeamLogoFile, setEditTeamLogoFile] = useState<File | null>(null);
  const [editForm, setEditForm] = useState<EditableProfileForm>({
    nickname: '',
    realName: '',
    bloodGroup: 'O+',
    team: '',
    operatorRole: 'assault',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactName2: '',
    emergencyContactPhone2: '',
    allergies: '',
    avatarUrl: '',
    teamLogoUrl: ''
  });

  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [operatorData, setOperatorData] = useState<CredentialOperatorViewModel | null>(null);
  const [activeExperienceSection, setActiveExperienceSection] = useState<'id' | 'operations' | 'marketplace'>('id');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeAdminWorkspace, setActiveAdminWorkspace] = useState<AdminOpsWorkspace>('eventos');
  const [activeGodWorkspace, setActiveGodWorkspace] = useState<GodWorkspace>('users');
  const [canAccessFieldOperations, setCanAccessFieldOperations] = useState(false);
  const [fieldOpsAccessResolved, setFieldOpsAccessResolved] = useState(false);
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [canManageFieldAdminsByEmail, setCanManageFieldAdminsByEmail] = useState(false);
  const [scannerEventId, setScannerEventId] = useState('');
  const [scannerEventOptions, setScannerEventOptions] = useState<Array<{ id: string; title: string; event_date: string }>>([]);
  const [scannerEventsLoading, setScannerEventsLoading] = useState(false);

  async function resolveFieldOperationsAccessForSession(userId: string): Promise<boolean> {
    if (!supabase) {
      return false;
    }

    const accessRpc = await supabase.rpc('can_access_field_operations');
    if (!accessRpc.error && accessRpc.data === true) {
      return true;
    }

    const emailAdminMaintainerRpc = await supabase.rpc('can_manage_field_admins_by_email');
    if (!emailAdminMaintainerRpc.error && emailAdminMaintainerRpc.data === true) {
      return true;
    }

    const organizerRpc = await supabase.rpc('is_platform_organizer');
    if (!organizerRpc.error && organizerRpc.data === true) {
      return true;
    }

    const roleCheckPrimary = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['field_admin', 'organizer', 'super_admin'])
      .limit(1);

    if (!roleCheckPrimary.error && roleCheckPrimary.data && roleCheckPrimary.data.length > 0) {
      return true;
    }

    const roleCheckLegacy = await supabase
      .from('user_roles')
      .select('user_role')
      .eq('user_id', userId)
      .in('user_role', ['field_admin', 'organizer', 'super_admin'])
      .limit(1);

    if (!roleCheckLegacy.error && roleCheckLegacy.data && roleCheckLegacy.data.length > 0) {
      return true;
    }

    return false;
  }

  async function resolveGodAdminAccessForSession(): Promise<{ canManageRoles: boolean; canManageFieldAdminsByEmail: boolean }> {
    if (!supabase) {
      return { canManageRoles: false, canManageFieldAdminsByEmail: false };
    }

    const [rolesRpc, fieldAdminRpc] = await Promise.all([
      supabase.rpc('can_manage_roles'),
      supabase.rpc('can_manage_field_admins_by_email')
    ]);

    return {
      canManageRoles: !rolesRpc.error && rolesRpc.data === true,
      canManageFieldAdminsByEmail: !fieldAdminRpc.error && fieldAdminRpc.data === true
    };
  }

  async function resolveOperatorFromQr(rawQr: string): Promise<{
    operatorUserId: string;
    nickname: string;
    role: string;
    bloodGroup: string;
    team?: string;
  }> {
    if (!supabase) {
      throw new Error('Supabase no disponible.');
    }

    const parsed = parseQrPayload(rawQr);
    const candidateUserId = parsed.userId?.trim() ?? '';

    if (candidateUserId && UUID_RE.test(candidateUserId)) {
      const { data, error } = await supabase
        .from('operator_profiles')
        .select('user_id,nickname,operator_role,blood_group,team')
        .eq('user_id', candidateUserId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        return {
          operatorUserId: data.user_id,
          nickname: data.nickname,
          role: data.operator_role,
          bloodGroup: data.blood_group,
          team: data.team ?? undefined
        };
      }
    }

    const token = parsed.token?.trim() ?? rawQr.trim();
    if (token) {
      if (UUID_RE.test(token)) {
        const { data, error } = await supabase
          .from('operator_profiles')
          .select('user_id,nickname,operator_role,blood_group,team')
          .eq('unique_qr_token', token)
          .maybeSingle();

        if (error) throw error;
        if (data) {
          return {
            operatorUserId: data.user_id,
            nickname: data.nickname,
            role: data.operator_role,
            bloodGroup: data.blood_group,
            team: data.team ?? undefined
          };
        }
      }

      const { data: credentialRows, error: credentialError } = await supabase
        .from('operator_profiles')
        .select('user_id,nickname,operator_role,blood_group,team')
        .eq('credential_code', token)
        .limit(1);

      if (credentialError) {
        const allowMissingColumn = credentialError.message.toLowerCase().includes('credential_code');
        if (!allowMissingColumn) {
          throw credentialError;
        }
      }

      if (credentialRows && credentialRows[0]) {
        const operator = credentialRows[0] as {
          user_id: string;
          nickname: string;
          operator_role: string;
          blood_group: string;
          team: string | null;
        };

        return {
          operatorUserId: operator.user_id,
          nickname: operator.nickname,
          role: operator.operator_role,
          bloodGroup: operator.blood_group,
          team: operator.team ?? undefined
        };
      }
    }

    if (parsed.nickname) {
      const { data, error } = await supabase
        .from('operator_profiles')
        .select('user_id,nickname,operator_role,blood_group,team')
        .eq('nickname', parsed.nickname)
        .limit(1);

      if (error) throw error;
      if (data && data[0]) {
        const operator = data[0] as {
          user_id: string;
          nickname: string;
          operator_role: string;
          blood_group: string;
          team: string | null;
        };

        return {
          operatorUserId: operator.user_id,
          nickname: operator.nickname,
          role: operator.operator_role,
          bloodGroup: operator.blood_group,
          team: operator.team ?? undefined
        };
      }
    }

    throw new Error('Jugador no registrado con AirsoftID.');
  }

  const rutSecretKey = (import.meta.env.VITE_RUT_SECRET_KEY as string | undefined)?.trim();
  const envRedirectUrlRaw = (import.meta.env.VITE_APP_REDIRECT_URL as string | undefined)?.trim();
  const runtimeOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
  const envRedirectUrl = envRedirectUrlRaw
    && (import.meta.env.DEV || !/localhost|127\.0\.0\.1/i.test(envRedirectUrlRaw))
    ? envRedirectUrlRaw
    : undefined;
  const appRedirectUrl = envRedirectUrl || runtimeOrigin;

  function toFriendlyError(error: unknown): string {
    const supabaseError = error as SupabaseLikeError;
    const rawMessage = sanitizeUiMessage(supabaseError?.message ?? 'Error desconocido');

    if (supabaseError?.code === '23505' && rawMessage.includes('operator_profiles_nickname_key')) {
      return 'Ese nickname ya esta en uso. Elige otro o libera el nickname desde la cuenta anterior.';
    }

    if (supabaseError?.code === '23505' && rawMessage.includes('idx_operator_profiles_rut_fingerprint')) {
      return 'Este RUT ya esta registrado en otra cuenta.';
    }

    if (rawMessage.includes('RUT already registered in another account')) {
      return 'Este RUT ya esta registrado en otra cuenta.';
    }

    if (rawMessage.includes('Invalid RUT format or verifier digit')) {
      return 'El RUT ingresado no es valido (revisa digito verificador).';
    }

    if (rawMessage.toLowerCase().includes('could not find the function public.register_my_operator_profile')) {
      return 'No pudimos completar tu registro porque el backend de perfil no esta sincronizado. Avisa al equipo para aplicar las migraciones de registro.';
    }

    if (rawMessage.toLowerCase().includes('function digest(')) {
      return 'No pudimos completar tu registro porque falta inicializar la extension de seguridad (pgcrypto) en la base de datos. Ejecuta la migracion de hardening nuevamente.';
    }

    return rawMessage;
  }

  function normalizeAvatarUrl(rawUrl: string | null | undefined): string | null {
    if (!rawUrl) {
      return null;
    }

    const value = rawUrl.trim();
    if (!value) {
      return null;
    }

    // Users often paste Google Images result URLs; extract the real image URL.
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      if ((host.includes('google.') || host.includes('bing.')) && parsed.searchParams.get('imgurl')) {
        const embedded = parsed.searchParams.get('imgurl');
        if (embedded) {
          return normalizeAvatarUrl(embedded);
        }
      }
    } catch {
      // Keep existing normalization flow for non-URL raw values.
    }

    if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) {
      return value;
    }

    if (value.startsWith('//')) {
      return `https:${value}`;
    }

    if (value.startsWith('www.')) {
      return `https://${value}`;
    }

    return value;
  }

  async function uploadTeamLogo(file: File, userId: string): Promise<string> {
    if (!supabase) {
      throw new Error('Supabase no esta configurado');
    }

    const optimizedFile = await optimizeTeamLogoFile(file);
    const safeName = optimizedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectPath = `${userId}/team-logo-${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from('operator-team-logos')
      .upload(objectPath, optimizedFile, { upsert: true, contentType: optimizedFile.type });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from('operator-team-logos').getPublicUrl(objectPath);
    return data.publicUrl;
  }

  async function optimizeTeamLogoFile(file: File): Promise<File> {
    // Keep SVG logos as-is to preserve vectors/transparency and avoid raster artifacts.
    if (file.type === 'image/svg+xml') {
      return file;
    }

    const imageBitmap = await createImageBitmap(file);
    const maxSize = 512;
    const scale = Math.min(1, maxSize / Math.max(imageBitmap.width, imageBitmap.height));
    const targetWidth = Math.max(1, Math.round(imageBitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(imageBitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');

    if (!context) {
      if (typeof imageBitmap.close === 'function') {
        imageBitmap.close();
      }
      return file;
    }

    context.clearRect(0, 0, targetWidth, targetHeight);
    context.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);
    if (typeof imageBitmap.close === 'function') {
      imageBitmap.close();
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/webp', 0.86);
    });

    if (!blob) {
      return file;
    }

    const baseName = file.name.replace(/\.[^/.]+$/, '') || 'team-logo';
    return new File([blob], `${baseName}.webp`, { type: 'image/webp' });
  }

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) {
        return;
      }

      setSessionUserId(data.session?.user.id ?? null);
      setSessionUserEmail(data.session?.user.email ?? null);
      const metadata = (data.session?.user.user_metadata ?? {}) as Record<string, unknown>;
      setSessionRutHint(typeof metadata.rut === 'string' ? metadata.rut : null);
      setSessionNameHint(typeof metadata.legal_full_names === 'string' ? metadata.legal_full_names : null);
      setAuthLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSessionUserId(nextSession?.user.id ?? null);
      setSessionUserEmail(nextSession?.user.email ?? null);
      const metadata = (nextSession?.user.user_metadata ?? {}) as Record<string, unknown>;
      setSessionRutHint(typeof metadata.rut === 'string' ? metadata.rut : null);
      setSessionNameHint(typeof metadata.legal_full_names === 'string' ? metadata.legal_full_names : null);
      setAuthError(null);
      setAuthMessage(null);
      setEditMode(false);
      setEditError(null);
      setEditHint(null);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadFieldOperationsAccess() {
      if (!supabase || !sessionUserId) {
        if (active) {
          setCanAccessFieldOperations(false);
          setCanManageRoles(false);
          setCanManageFieldAdminsByEmail(false);
          setFieldOpsAccessResolved(true);
        }
        return;
      }

      try {
        const [allowed, godAccess] = await Promise.all([
          resolveFieldOperationsAccessForSession(sessionUserId),
          resolveGodAdminAccessForSession()
        ]);
        if (active) {
          setCanAccessFieldOperations(allowed);
          setCanManageRoles(godAccess.canManageRoles);
          setCanManageFieldAdminsByEmail(godAccess.canManageFieldAdminsByEmail);
        }
      } catch {
        if (active) {
          setCanAccessFieldOperations(false);
          setCanManageRoles(false);
          setCanManageFieldAdminsByEmail(false);
        }
      } finally {
        if (active) {
          setFieldOpsAccessResolved(true);
        }
      }
    }

    setFieldOpsAccessResolved(false);
    void loadFieldOperationsAccess();

    return () => {
      active = false;
    };
  }, [sessionUserId]);

  useEffect(() => {
    if (!canAccessFieldOperations && activeExperienceSection === 'operations') {
      setActiveExperienceSection('id');
    }
  }, [canAccessFieldOperations, activeExperienceSection]);

  useEffect(() => {
    const canAccessGodWorkspace = canManageRoles || canManageFieldAdminsByEmail;
    if (!canAccessGodWorkspace && activeAdminWorkspace === 'god') {
      setActiveAdminWorkspace('eventos');
    }
  }, [canManageRoles, canManageFieldAdminsByEmail, activeAdminWorkspace]);

  useEffect(() => {
    if (!canAccessFieldOperations || !supabase || !sessionUserId) {
      setScannerEventOptions([]);
      return;
    }

    let active = true;

    async function loadScannerEvents() {
      if (!supabase) return;
      setScannerEventsLoading(true);
      try {
        // Resolve scoped field IDs for this admin
        let scopedFieldIds: string[] = [];
        const myFieldsRes = await supabase.rpc('list_accessible_fields_for_operations');
        if (!myFieldsRes.error && Array.isArray(myFieldsRes.data)) {
          scopedFieldIds = (myFieldsRes.data as Array<{ id: string }>).map((f) => f.id);
        }

        let query = supabase
          .from('events')
          .select('id,title,event_date')
          .is('ends_at', null)
          .order('created_at', { ascending: false })
          .limit(100);

        if (scopedFieldIds.length > 0) {
          query = query.in('field_id', scopedFieldIds);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (active) {
          const opts = (data as Array<{ id: string; title: string; event_date: string }> | null) ?? [];
          setScannerEventOptions(opts);
          // Auto-select if only one event or current selection is invalid
          setScannerEventId((prev) => {
            if (prev && opts.some((o) => o.id === prev)) return prev;
            return opts[0]?.id ?? '';
          });
        }
      } catch {
        if (active) {
          setScannerEventOptions([]);
        }
      } finally {
        if (active) {
          setScannerEventsLoading(false);
        }
      }
    }

    void loadScannerEvents();

    return () => {
      active = false;
    };
  }, [canAccessFieldOperations, sessionUserId]);

  useEffect(() => {
    let active = true;

    async function loadCurrentUserCredential() {
      if (!hasSupabaseConfig || !supabase) {
        if (active) {
          setOperatorData(null);
          setMetricsError('Falta configurar Supabase en frontend/app/.env');
        }
        return;
      }

      if (!sessionUserId) {
        if (active) {
          setOperatorData(null);
          setMetricsError(null);
          setNeedsIdentityOnboarding(false);
          setNeedsRegistration(false);
          setIdentityRut(null);
          setIdentityFullName(null);
          setProfileLoading(false);
        }
        return;
      }

      try {
        setProfileLoading(true);
        setMetricsLoading(true);
        setMetricsError(null);

        let resolvedIdentityRut = sessionRutHint ?? null;
        let resolvedIdentityName = sessionNameHint ?? null;

        const identityResponse = await supabase.rpc('get_my_identity_summary');
        if (!identityResponse.error) {
          const ownIdentity = Array.isArray(identityResponse.data) ? identityResponse.data[0] : identityResponse.data;
          const identityData = ownIdentity as { rut?: string; legal_full_names?: string } | null;
          resolvedIdentityRut = identityData?.rut ?? resolvedIdentityRut;
          resolvedIdentityName = identityData?.legal_full_names ?? resolvedIdentityName;
          setIdentityRut(resolvedIdentityRut);
          setIdentityFullName(resolvedIdentityName);
        } else {
          setIdentityRut(resolvedIdentityRut);
          setIdentityFullName(resolvedIdentityName);
        }

        const profileQuery = await supabase
          .from('operator_profiles')
          .select('*')
          .eq('user_id', sessionUserId)
          .maybeSingle();

        const { data: profile, error: profileError } = profileQuery;

        if (profileError) {
          throw profileError;
        }

        if (!profile) {
          if (active) {
            const hasIdentity = Boolean(resolvedIdentityRut && resolvedIdentityName);
            setNeedsIdentityOnboarding(!hasIdentity);
            setNeedsRegistration(hasIdentity);
            setOperatorData(null);
            setMetricsError(null);
            setIdentityOnboardingForm((prev) => ({
              ...prev,
              rut: prev.rut || resolvedIdentityRut || '',
              fullName: prev.fullName || resolvedIdentityName || ''
            }));
            setRegistrationForm((prev) => ({
              ...prev,
              rut: prev.rut || resolvedIdentityRut || '',
              realName: prev.realName || resolvedIdentityName || ''
            }));
            setProfileLoading(false);
            setMetricsLoading(false);
          }
          return;
        }

        setNeedsIdentityOnboarding(false);
        setNeedsRegistration(false);

        let row: Awaited<ReturnType<typeof getOperatorIdMetricsByUserId>> = null;
        let directOperatorScore: number | null = null;

        try {
          row = await getOperatorIdMetricsByUserId(sessionUserId);
        } catch (metricsLoadError) {
          setMetricsError(`${(metricsLoadError as Error).message}. Se muestra una credencial basica.`);
        }

        try {
          directOperatorScore = await getOperatorMetricScoreByUserId(sessionUserId);
        } catch (directScoreError) {
          if (!metricsError) {
            setMetricsError(`${(directScoreError as Error).message}. Se muestra una credencial basica.`);
          }
        }

        if (!active) {
          return;
        }

        const emergencyPhones = splitEmergencyPhones(profile.emergency_contact_phone);

        setOperatorData({
          nickname: row?.nickname ?? profile.nickname,
          realName: row?.real_name ?? profile.real_name,
          role: row?.operator_role ?? (profile as { operator_role?: string }).operator_role ?? 'assault',
          team: row?.team ?? profile.team ?? 'Sin equipo',
          bloodGroup: row?.blood_group ?? (profile as { blood_group?: string }).blood_group ?? 'O+',
          operatorScore: resolveOperatorScore({
            directOperatorScore,
            operatorScoreFromView: row?.operator_score ?? null,
            fairPlayScore: row?.fair_play_score ?? 0,
            eventsExperienceScore: row?.events_experience_score ?? 0,
            achievementsScore: row?.achievements_score ?? 0
          }),
          avatarUrl:
            normalizeAvatarUrl(profile.avatar_url)
            ?? `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(row?.nickname ?? profile.nickname)}`,
          teamLogoUrl: normalizeAvatarUrl(profile.team_logo_url) ?? undefined,
          qrImageUrl:
            `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(JSON.stringify({ userId: profile.user_id, nickname: row?.nickname ?? profile.nickname }))}`,
          iceName: profile.emergency_contact_name ?? 'Sin dato',
          icePhone: emergencyPhones.phone1 || 'Sin dato',
          iceName2: (profile as { emergency_contact_name_2?: string | null }).emergency_contact_name_2 ?? undefined,
          icePhone2:
            (profile as { emergency_contact_phone_2?: string | null }).emergency_contact_phone_2
            ?? (emergencyPhones.phone2 || undefined),
          allergies: (profile as { allergies?: string | null }).allergies ?? undefined,
          credentialId: row?.credential_code ?? 'SIN-CODIGO',
          medals: ['Credencial activa'],
          fairPlayScore: row?.fair_play_score ?? 0,
          totalFairPlayGreen: row?.total_fair_play_green ?? 0,
          totalFairPlayYellow: row?.total_fair_play_yellow ?? 0,
          totalFairPlayRed: row?.total_fair_play_red ?? 0,
          confirmedEvents: row?.total_confirmed_events ?? 0,
          achievementsUnlocked: row?.total_achievements_unlocked ?? 0
        });

        setEditForm({
          nickname: profile.nickname,
          realName: profile.real_name,
          bloodGroup: (profile as { blood_group?: string }).blood_group ?? 'O+',
          team: profile.team ?? '',
          operatorRole: (profile as { operator_role?: string }).operator_role ?? 'assault',
          emergencyContactName: profile.emergency_contact_name ?? '',
          emergencyContactPhone: emergencyPhones.phone1,
          emergencyContactName2: (profile as { emergency_contact_name_2?: string | null }).emergency_contact_name_2 ?? '',
          emergencyContactPhone2:
            (profile as { emergency_contact_phone_2?: string | null }).emergency_contact_phone_2
            ?? emergencyPhones.phone2,
          allergies: (profile as { allergies?: string | null }).allergies ?? '',
          avatarUrl: normalizeAvatarUrl(profile.avatar_url) ?? '',
          teamLogoUrl: normalizeAvatarUrl(profile.team_logo_url) ?? ''
        });
      } catch (error) {
        if (active) {
          setOperatorData(null);
          setMetricsError(toFriendlyError(error));
        }
      } finally {
        if (active) {
          setProfileLoading(false);
          setMetricsLoading(false);
        }
      }
    }

    loadCurrentUserCredential();

    return () => {
      active = false;
    };
  }, [sessionUserId, profileReloadTick, sessionRutHint, sessionNameHint]);

  async function handleCompleteIdentityOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !sessionUserId || !sessionUserEmail) {
      setIdentityOnboardingError('Debes iniciar sesion antes de completar tu identidad.');
      return;
    }

    if (!identityOnboardingForm.rut.trim()) {
      setIdentityOnboardingError('Debes ingresar tu RUT.');
      return;
    }

    if (!isValidRutValue(identityOnboardingForm.rut.trim())) {
      setIdentityOnboardingError('El RUT ingresado no es valido (revisa el digito verificador).');
      return;
    }

    if (!identityOnboardingForm.fullName.trim()) {
      setIdentityOnboardingError('Debes ingresar el nombre legal.');
      return;
    }

    if (!(identityOnboardingForm.acceptPrivacy && identityOnboardingForm.acceptTerms && identityOnboardingForm.acceptDataProcessing)) {
      setIdentityOnboardingError('Debes aceptar todos los avisos legales para continuar.');
      return;
    }

    try {
      setIdentityOnboardingLoading(true);
      setIdentityOnboardingError(null);

      const { error } = await supabase.rpc('register_my_identity_with_rut', {
        p_rut: identityOnboardingForm.rut.trim(),
        p_email: sessionUserEmail,
        p_age: 18,
        p_autocompleted_full_names: identityOnboardingForm.fullName.trim(),
        p_names_source: 'manual_form',
        p_privacy_version: 'priv-v1',
        p_terms_version: 'terms-v1',
        p_data_processing_version: 'dp-v1',
        p_accept_privacy: true,
        p_accept_terms: true,
        p_accept_data_processing: true,
        p_guardian_full_name: null,
        p_guardian_rut: null,
        p_guardian_email: null,
        p_guardian_acceptance: false,
        p_ip: null,
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'web-client'
      });

      if (error) {
        throw error;
      }

      setIdentityRut(identityOnboardingForm.rut.trim());
      setIdentityFullName(identityOnboardingForm.fullName.trim());
      setRegistrationForm((prev) => ({
        ...prev,
        rut: identityOnboardingForm.rut.trim(),
        realName: identityOnboardingForm.fullName.trim()
      }));
      setNeedsIdentityOnboarding(false);
      setNeedsRegistration(true);
      setAuthMessage('Identidad registrada. Ahora completa los datos de operador.');
    } catch (error) {
      setIdentityOnboardingError(toFriendlyError(error));
    } finally {
      setIdentityOnboardingLoading(false);
    }
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setAuthError('Supabase no esta configurado');
      return;
    }

    setAuthError(null);
    setAuthMessage(null);

    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          throw error;
        }
        setAuthMessage('Sesion iniciada correctamente.');
      } else {
        const { data, error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: appRedirectUrl
          }
        });
        if (error) {
          throw error;
        }

        if (data.user) {
          setAuthMessage('Te enviamos un enlace a tu correo. Confirma tu correo para activar la cuenta e iniciar sesion.');
        } else {
          setAuthMessage('Si el correo es valido, recibiras un enlace para confirmar e ingresar.');
        }
      }
    } catch (error) {
      setAuthError(toFriendlyError(error));
    }
  }

  async function handleLogout() {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setOperatorData(null);
    setNeedsRegistration(false);
    setNeedsIdentityOnboarding(false);
    setShowCredentialModal(false);
    setCanAccessFieldOperations(false);
    setCanManageRoles(false);
    setCanManageFieldAdminsByEmail(false);
    setFieldOpsAccessResolved(false);
    setActiveExperienceSection('id');
    setActiveAdminWorkspace('eventos');
    setScannerEventId('');
  }

  async function handleOAuthLogin(provider: 'google' | 'facebook') {
    if (!supabase) {
      setAuthError('Supabase no esta configurado');
      return;
    }

    setAuthError(null);
    setAuthMessage(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: appRedirectUrl
      }
    });

    if (error) {
      setAuthError(toFriendlyError(error));
    }
  }

  async function handleRegisterProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !sessionUserId) {
      setRegistrationError('Debes iniciar sesion antes de registrar tu perfil.');
      return;
    }

    const resolvedRut = identityRut ?? registrationForm.rut;
    const resolvedFullName = identityFullName ?? registrationForm.realName;

    if (!resolvedRut || !resolvedFullName) {
      setRegistrationError('Completa primero el formulario de identidad (RUT y nombre legal).');
      return;
    }

    try {
      setRegistrationLoading(true);
      setRegistrationError(null);
      const idCardStorageUri = `pending://operator-id-documents/${sessionUserId}/${Date.now()}`;
      const resolvedRutSecretKey = rutSecretKey || 'temporary-registration-key-v1';

      const payload = {
        p_nickname: registrationForm.nickname,
        p_real_name: resolvedFullName,
        p_rut_plain: resolvedRut,
        p_rut_secret_key: resolvedRutSecretKey,
        p_blood_group: registrationForm.bloodGroup,
        p_team: registrationForm.team || null,
        p_operator_role: registrationForm.operatorRole,
        p_emergency_contact_name: registrationForm.emergencyContactName,
        p_emergency_contact_phone: registrationForm.emergencyContactPhone,
        p_avatar_url: registrationForm.avatarUrl || null,
        p_id_card_photo_url: idCardStorageUri
      };

      const rpcResponse = await supabase.rpc('register_my_operator_profile', payload);
      if (rpcResponse.error) {
        throw rpcResponse.error;
      }

      setNeedsRegistration(false);
      setShowCredentialModal(false);
      setAuthMessage('Perfil registrado correctamente.');
      setRegistrationForm({
        nickname: '',
        realName: '',
        rut: '',
        bloodGroup: 'O+',
        team: '',
        operatorRole: 'assault',
        emergencyContactName: '',
        emergencyContactPhone: '',
        avatarUrl: ''
      });

      const row = await getOperatorIdMetricsByUserId(sessionUserId);
      if (row) {
        const directOperatorScore = await getOperatorMetricScoreByUserId(sessionUserId);

        setOperatorData({
          nickname: row.nickname,
          realName: row.real_name,
          role: row.operator_role,
          team: row.team ?? 'Sin equipo',
          bloodGroup: row.blood_group,
          operatorScore: resolveOperatorScore({
            directOperatorScore,
            operatorScoreFromView: row.operator_score,
            fairPlayScore: row.fair_play_score,
            eventsExperienceScore: row.events_experience_score,
            achievementsScore: row.achievements_score
          }),
          avatarUrl: `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(row.nickname)}`,
          teamLogoUrl: undefined,
          qrImageUrl:
            `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(JSON.stringify({ userId: sessionUserId, nickname: row.nickname }))}`,
          iceName: registrationForm.emergencyContactName,
          icePhone: registrationForm.emergencyContactPhone,
          iceName2: undefined,
          icePhone2: undefined,
          allergies: undefined,
          credentialId: row.credential_code ?? 'SIN-CODIGO',
          medals: ['Credencial activa'],
          fairPlayScore: row.fair_play_score ?? 0,
          totalFairPlayGreen: row.total_fair_play_green ?? 0,
          totalFairPlayYellow: row.total_fair_play_yellow ?? 0,
          totalFairPlayRed: row.total_fair_play_red ?? 0,
          confirmedEvents: row.total_confirmed_events ?? 0,
          achievementsUnlocked: row.total_achievements_unlocked ?? 0
        });
      }

      setProfileReloadTick((prev) => prev + 1);
    } catch (error) {
      setRegistrationError(toFriendlyError(error));
    } finally {
      setRegistrationLoading(false);
    }
  }

  async function handleEditCardInput(file: File | null) {
    setEditTeamLogoFile(file);
    setEditHint(null);
    if (!file) {
      return;
    }

    setEditHint('Logo de equipo listo para guardar.');
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !sessionUserId) {
      setEditError('No hay sesion activa para actualizar perfil.');
      return;
    }

    try {
      setEditLoading(true);
      setEditError(null);
      setEditHint(null);

      const { error: rpcError } = await supabase.rpc('update_my_operator_profile', {
        p_nickname: editForm.nickname,
        p_real_name: editForm.realName,
        p_blood_group: editForm.bloodGroup,
        p_team: editForm.team || null,
        p_operator_role: editForm.operatorRole,
        p_emergency_contact_name: editForm.emergencyContactName || null,
        p_emergency_contact_phone: editForm.emergencyContactPhone || null,
        p_avatar_url: editForm.avatarUrl || null,
        p_emergency_contact_name_2: editForm.emergencyContactName2 || null,
        p_emergency_contact_phone_2: editForm.emergencyContactPhone2 || null,
        p_allergies: editForm.allergies.trim() || null
      });

      if (rpcError) {
        throw rpcError;
      }

      let nextTeamLogoUrl = editForm.teamLogoUrl;
      if (editTeamLogoFile) {
        nextTeamLogoUrl = await uploadTeamLogo(editTeamLogoFile, sessionUserId);
      }

      const { error: updateIdentityError } = await supabase
        .from('operator_profiles')
        .update({
          emergency_contact_name_2: editForm.emergencyContactName2 || null,
          emergency_contact_phone_2: editForm.emergencyContactPhone2 || null,
          allergies: editForm.allergies.trim() || null,
          team_logo_url: nextTeamLogoUrl || null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', sessionUserId);

      if (updateIdentityError) {
        throw updateIdentityError;
      }

      let persistedIceName2: string | undefined = editForm.emergencyContactName2 || undefined;
      let persistedIcePhone2: string | undefined = editForm.emergencyContactPhone2 || undefined;
      let persistedAllergies: string | undefined = editForm.allergies.trim() || undefined;

      const persistedFieldsQuery = await supabase
        .from('operator_profiles')
        .select('emergency_contact_phone,emergency_contact_name_2,emergency_contact_phone_2,allergies')
        .eq('user_id', sessionUserId)
        .maybeSingle();

      if (!persistedFieldsQuery.error && persistedFieldsQuery.data) {
        const persisted = persistedFieldsQuery.data as {
          emergency_contact_phone?: string | null;
          emergency_contact_name_2?: string | null;
          emergency_contact_phone_2?: string | null;
          allergies?: string | null;
        };
        const fallbackPhones = splitEmergencyPhones(persisted.emergency_contact_phone);
        persistedIceName2 = persisted.emergency_contact_name_2 ?? persistedIceName2;
        persistedIcePhone2 = persisted.emergency_contact_phone_2 ?? fallbackPhones.phone2 ?? persistedIcePhone2;
        persistedAllergies = persisted.allergies ?? persistedAllergies;
      }

      setOperatorData((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          nickname: editForm.nickname || prev.nickname,
          role: editForm.operatorRole || prev.role,
          team: editForm.team || 'Sin equipo',
          bloodGroup: editForm.bloodGroup || prev.bloodGroup,
          avatarUrl: editForm.avatarUrl || prev.avatarUrl,
          teamLogoUrl: nextTeamLogoUrl || undefined,
          iceName: editForm.emergencyContactName || 'Sin dato',
          icePhone: editForm.emergencyContactPhone || 'Sin dato',
          iceName2: persistedIceName2,
          icePhone2: persistedIcePhone2,
          allergies: persistedAllergies
        };
      });

      setEditTeamLogoFile(null);
      setEditMode(false);
      setAuthMessage('Perfil actualizado correctamente.');
      setProfileReloadTick((prev) => prev + 1);

      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          window.location.reload();
        }, 150);
      }
    } catch (error) {
      setEditError(toFriendlyError(error));
    } finally {
      setEditLoading(false);
    }
  }

  useEffect(() => {
    if (!sessionUserId) {
      setShowCredentialModal(false);
      return;
    }

    if (needsIdentityOnboarding || needsRegistration) {
      setShowCredentialModal(true);
    }
  }, [sessionUserId, needsIdentityOnboarding, needsRegistration]);

  if (!hasSupabaseConfig) {
    return (
      <main className="page-shell auth-shell">
        <div className="page-bg" />
        <section className="page-grid page-grid-auth">
          <div className="auth-card">
            <h1 className="page-title">ID Airsoft Chile</h1>
            <p className="page-subtitle">Falta configurar Supabase en frontend/app/.env para continuar.</p>
          </div>
        </section>
      </main>
    );
  }

  if (authLoading) {
    return (
      <main className="page-shell auth-shell">
        <div className="page-bg" />
        <section className="page-grid page-grid-auth">
          <div className="auth-card">
            <BrandLogo />
            <h1 className="page-title">ID Airsoft Chile</h1>
            <p className="page-subtitle">Validando sesion...</p>
          </div>
        </section>
      </main>
    );
  }

  if (!sessionUserId) {
    return (
      <main className="page-shell auth-shell">
        <div className="page-bg" />
        <section className="page-grid page-grid-auth">
          <div className="auth-card auth-card-login">
            <header className="auth-header">
              <p className="auth-kicker">Portal seguro de acceso</p>
              <h1 className="page-title">ID Airsoft Chile</h1>
              <p className="page-subtitle auth-subtitle">
                Primera vez aqui: registrate con RUT + correo, confirma email y completa el perfil en tu primer ingreso.
              </p>
            </header>

            <form className="auth-form auth-form-login" onSubmit={handleAuthSubmit}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="nombre@correo.cl"
                />
              </label>
              {authMode === 'login' ? (
                <label>
                  Contrasena
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    required
                    placeholder="Minimo 6 caracteres"
                  />
                </label>
              ) : (
                <p className="page-subtitle auth-message">
                  Te enviaremos un enlace de confirmacion a tu correo. Al primer ingreso te pediremos RUT, nombre legal y consentimientos.
                </p>
              )}

              <button type="submit" className="primary-btn">
                {authMode === 'login' ? 'Iniciar sesion' : 'Registrar y confirmar correo'}
              </button>
            </form>

            <p className="auth-divider">o continuar con</p>

            <div className="oauth-row">
              <button
                type="button"
                className="oauth-btn oauth-google oauth-google-brand"
                onClick={() => handleOAuthLogin('google')}
              >
                <svg className="google-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                  <path
                    fill="#EA4335"
                    d="M9 3.48c1.69 0 2.84.73 3.49 1.34l2.54-2.54C13.44.8 11.4 0 9 0 5.48 0 2.44 2.02.96 4.96l2.95 2.29C4.62 5.16 6.62 3.48 9 3.48z"
                  />
                  <path
                    fill="#4285F4"
                    d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.12-.84 2.07-1.8 2.7v2.24h2.91c1.7-1.56 2.69-3.86 2.69-6.58z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M3.91 10.75A5.41 5.41 0 0 1 3.6 9c0-.61.11-1.2.31-1.75V5.01H.96A8.98 8.98 0 0 0 0 9c0 1.45.35 2.83.96 3.99l2.95-2.24z"
                  />
                  <path
                    fill="#34A853"
                    d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.24c-.8.54-1.83.86-3.05.86-2.35 0-4.35-1.59-5.06-3.73l-2.95 2.24C2.44 15.98 5.48 18 9 18z"
                  />
                </svg>
                <span>Sign in with Google</span>
              </button>
            </div>

            <button
              type="button"
              className="ghost-btn auth-toggle-btn"
              onClick={() => setAuthMode((prev) => (prev === 'login' ? 'signup' : 'login'))}
            >
              {authMode === 'login'
                ? 'Registrar'
                : 'Iniciar sesion'}
            </button>

            {authMessage && <p className="page-subtitle auth-message" aria-live="polite">{authMessage}</p>}
            {authError && <p className="error-text" aria-live="assertive">{sanitizeUiMessage(authError)}</p>}
          </div>
        </section>
      </main>
    );
  }

  if (profileLoading) {
    return (
      <main className="page-shell auth-shell">
        <div className="page-bg" />
        <section className="page-grid page-grid-auth">
          <div className="auth-card">
            <BrandLogo />
            <h1 className="page-title">ID Airsoft Chile</h1>
            <p className="page-subtitle">Cargando perfil de operador...</p>
          </div>
        </section>
      </main>
    );
  }

  const needsCredentialSetup = needsIdentityOnboarding || needsRegistration;
  const showingIdentityStep = needsIdentityOnboarding;
  const isGodAdmin = canManageRoles || canManageFieldAdminsByEmail;
  const activeUserTypeLabel = isGodAdmin
    ? 'admin god'
    : canAccessFieldOperations
      ? 'administrador de cancha'
      : 'operador';

  return (
    <>
      <header className="app-header">
        <div className="app-header-brand">
          <BrandLogo />
          <h1 className="app-header-title">ID Airsoft</h1>
        </div>
        <button className="hamburger-btn" onClick={() => setIsMenuOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
      </header>

      <div className={`menu-overlay ${isMenuOpen ? 'is-open' : ''}`} onClick={() => setIsMenuOpen(false)} />
      <nav className={`side-menu ${isMenuOpen ? 'is-open' : ''}`}>
        <div className="side-menu-header">
          <h2>Menú</h2>
          <button className="close-menu-btn" onClick={() => setIsMenuOpen(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="side-menu-body">
          <div className="menu-group">
            <h3 className="menu-group-title">Jugador</h3>
            <button className={`menu-item ${activeExperienceSection === 'id' && !editMode ? 'is-active' : ''}`} onClick={() => { setActiveExperienceSection('id'); setEditMode(false); setIsMenuOpen(false); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              Mi Credencial
            </button>
            <button className={`menu-item ${editMode ? 'is-active' : ''}`} onClick={() => { setActiveExperienceSection('id'); setEditMode((prev) => !prev); setEditError(null); setEditHint(null); setIsMenuOpen(false); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
              {editMode ? 'Cancelar edición' : 'Editar mis datos'}
            </button>
            <button className={`menu-item ${activeExperienceSection === 'marketplace' ? 'is-active' : ''}`} onClick={() => { setActiveExperienceSection('marketplace'); setIsMenuOpen(false); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              Buscar Eventos
            </button>
          </div>

          {canAccessFieldOperations && (
            <div className="menu-group">
              <h3 className="menu-group-title">Organizador</h3>
              <button className={`menu-item ${activeExperienceSection === 'operations' && activeAdminWorkspace === 'eventos' ? 'is-active' : ''}`} onClick={() => { setActiveExperienceSection('operations'); setActiveAdminWorkspace('eventos'); setIsMenuOpen(false); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                Gestionar Eventos
              </button>
              <button className={`menu-item ${activeExperienceSection === 'operations' && activeAdminWorkspace === 'proceso' ? 'is-active' : ''}`} onClick={() => { setActiveExperienceSection('operations'); setActiveAdminWorkspace('proceso'); setIsMenuOpen(false); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                Proceso de Partida
              </button>
              <button className={`menu-item ${activeExperienceSection === 'operations' && activeAdminWorkspace === 'scanner' ? 'is-active' : ''}`} onClick={() => { setActiveExperienceSection('operations'); setActiveAdminWorkspace('scanner'); setIsMenuOpen(false); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><path d="M7 7h10"></path><path d="M7 12h10"></path><path d="M7 17h10"></path></svg>
                Escáner QR
              </button>
            </div>
          )}

          {isGodAdmin && (
            <div className="menu-group">
              <h3 className="menu-group-title">Superadmin GOD</h3>
              <button className={`menu-item ${activeExperienceSection === 'operations' && activeAdminWorkspace === 'god' && activeGodWorkspace === 'users' ? 'is-active' : ''}`} onClick={() => { setActiveExperienceSection('operations'); setActiveAdminWorkspace('god'); setActiveGodWorkspace('users'); setIsMenuOpen(false); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                Usuarios GOD
              </button>
              <button className={`menu-item ${activeExperienceSection === 'operations' && activeAdminWorkspace === 'god' && activeGodWorkspace === 'events' ? 'is-active' : ''}`} onClick={() => { setActiveExperienceSection('operations'); setActiveAdminWorkspace('god'); setActiveGodWorkspace('events'); setIsMenuOpen(false); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                Eventos GOD
              </button>
              <button className={`menu-item ${activeExperienceSection === 'operations' && activeAdminWorkspace === 'god' && activeGodWorkspace === 'fields' ? 'is-active' : ''}`} onClick={() => { setActiveExperienceSection('operations'); setActiveAdminWorkspace('god'); setActiveGodWorkspace('fields'); setIsMenuOpen(false); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
                Canchas GOD
              </button>
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button className="menu-item" style={{ color: '#ff7262' }} onClick={handleLogout}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              Cerrar sesión
            </button>
          </div>
        </div>
      </nav>

      <main className="page-shell page-shell-id-focus">
        <div className="page-bg" />
        <section className="page-grid page-grid-id-focus">
          <div className="id-focus-column">
            <h1 className="page-title" style={{ display: 'none' }}>ID Airsoft Chile</h1>

            {needsCredentialSetup ? (
              <div className="auth-card" style={{ marginBottom: '1rem' }}>
                <p className="page-subtitle" style={{ marginBottom: '0.75rem' }}>
                  Para obtener tu credencial ID, completa tu identidad y datos de operador.
                </p>
                <button type="button" className="primary-btn" onClick={() => setShowCredentialModal(true)}>
                  Completar credencial ID
                </button>
              </div>
            ) : null}

          {!canAccessFieldOperations && fieldOpsAccessResolved ? (
            <p className="page-subtitle id-sync-text">
              Modo jugador activo: Operaciones Cancha disponible solo para organizadores y administradores.
            </p>
          ) : null}

          {activeExperienceSection === 'id' ? (
            <>
              {metricsLoading && <p className="page-subtitle id-sync-text">Sincronizando metricas...</p>}
              {metricsError && <p className="page-subtitle id-sync-text">Error metricas: {sanitizeUiMessage(metricsError)}</p>}

              <div className="id-card-wrap">
                {operatorData ? (
                  <OperatorCredentialCard data={operatorData} defaultSkin="multicam" />
                ) : (
                  <p className="page-subtitle">
                    No se pudo construir la credencial del operador con los datos actuales de perfil.
                  </p>
                )}
              </div>

              {editMode && (
                <form className="auth-form edit-panel id-edit-panel" onSubmit={handleSaveProfile}>
                  <section className="edit-section" aria-labelledby="edit-required-title">
                    <h3 id="edit-required-title" className="edit-section-title">Datos obligatorios</h3>
                    <p className="edit-section-subtitle">Campos clave para la seguridad y contacto en juego.</p>

                    <label>
                      Grupo sanguineo
                      <select
                        value={editForm.bloodGroup}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, bloodGroup: e.target.value }))}
                        required
                      >
                        <option value="A+">A+</option>
                        <option value="A-">A-</option>
                        <option value="B+">B+</option>
                        <option value="B-">B-</option>
                        <option value="AB+">AB+</option>
                        <option value="AB-">AB-</option>
                        <option value="O+">O+</option>
                        <option value="O-">O-</option>
                      </select>
                    </label>
                    <label>
                      Contacto emergencia
                      <input
                        value={editForm.emergencyContactName}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, emergencyContactName: e.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      Telefono emergencia 1
                      <input
                        value={editForm.emergencyContactPhone}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, emergencyContactPhone: e.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      Contacto emergencia 2 (opcional)
                      <input
                        value={editForm.emergencyContactName2}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, emergencyContactName2: e.target.value }))}
                        placeholder="Opcional"
                      />
                    </label>
                    <label>
                      Telefono emergencia 2 (opcional)
                      <input
                        value={editForm.emergencyContactPhone2}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, emergencyContactPhone2: e.target.value }))}
                        placeholder="Opcional"
                      />
                    </label>
                    <label>
                      Alergias (opcional)
                      <input
                        value={editForm.allergies}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, allergies: e.target.value }))}
                        placeholder="Ej: Penicilina, AINES, mariscos"
                      />
                    </label>
                  </section>

                  <section className="edit-section" aria-labelledby="edit-optional-title">
                    <h3 id="edit-optional-title" className="edit-section-title">Datos no obligatorios</h3>
                    <p className="edit-section-subtitle">Puedes completarlos o cambiarlos cuando quieras.</p>
                    <label>
                      Equipo
                      <input
                        value={editForm.team}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, team: e.target.value }))}
                      />
                    </label>

                    <label>
                      Rol operador
                      <select
                        value={editForm.operatorRole}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, operatorRole: e.target.value }))}
                      >
                        <option value="assault">assault</option>
                        <option value="sniper">sniper</option>
                        <option value="medic">medic</option>
                        <option value="support">support</option>
                        <option value="dmr">dmr</option>
                        <option value="breacher">breacher</option>
                        <option value="recon">recon</option>
                        <option value="commander">commander</option>
                        <option value="other">other</option>
                      </select>
                    </label>
                    <label>
                      Nickname
                      <input
                        value={editForm.nickname}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, nickname: e.target.value }))}
                      />
                    </label>
                    <label>
                      URL avatar
                      <input
                        value={editForm.avatarUrl}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, avatarUrl: e.target.value }))}
                      />
                    </label>
                    <label>
                      Subir logo del equipo (opcional)
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={(e) => {
                          void handleEditCardInput(e.target.files?.[0] ?? null);
                        }}
                      />
                    </label>
                  </section>

                  {editHint && <p className="page-subtitle">{editHint}</p>}
                  {editError && <p className="error-text">{sanitizeUiMessage(editError)}</p>}

                  <button type="submit" className="primary-btn" disabled={editLoading}>
                    {editLoading ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </form>
              )}
            </>
          ) : activeExperienceSection === 'marketplace' ? (
            <OperatorEventMarketplace enabled={Boolean(sessionUserId)} />
          ) : activeExperienceSection === 'operations' && canAccessFieldOperations ? (
            <>
              {activeAdminWorkspace === 'eventos' ? (
                <FieldOperationsConsole
                  operatorNickname={(operatorData?.nickname || editForm.nickname || 'admin cancha').trim()}
                  operatorCredentialId={operatorData?.credentialId}
                  sessionUserId={sessionUserId}
                  allowedViews={['evento']}
                  initialView="evento"
                />
              ) : null}

              {activeAdminWorkspace === 'proceso' ? (
                <FieldOperationsConsole
                  operatorNickname={(operatorData?.nickname || editForm.nickname || 'admin cancha').trim()}
                  operatorCredentialId={operatorData?.credentialId}
                  sessionUserId={sessionUserId}
                  allowedViews={['equipos', 'partidas', 'tarjetas']}
                  initialView="equipos"
                />
              ) : null}

              {activeAdminWorkspace === 'scanner' ? (
                <details className="id-secondary-tools" open>
                  <summary>Escaner QR (herramienta independiente)</summary>
                  <div className="scanner-pane id-secondary-pane" style={{ display: 'grid', gap: '0.75rem' }}>
                    <label style={{ display: 'grid', gap: '0.25rem', textAlign: 'left' }}>
                      Evento a operar
                      {scannerEventsLoading ? (
                        <select disabled>
                          <option>Cargando eventos…</option>
                        </select>
                      ) : scannerEventOptions.length === 0 ? (
                        <select disabled>
                          <option>Sin eventos abiertos asignados</option>
                        </select>
                      ) : (
                        <select
                          value={scannerEventId}
                          onChange={(e) => setScannerEventId(e.target.value)}
                        >
                          {scannerEventOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.title} — {opt.event_date}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>

                    <OrganizerScannerView
                      eventId={scannerEventId.trim() || 'SIN-EVENTO'}
                      onResolveQr={resolveOperatorFromQr}
                      onCheckin={async ({ eventId, operatorUserId }) => {
                        if (!supabase) {
                          throw new Error('Supabase no disponible.');
                        }

                        if (!eventId || eventId === 'SIN-EVENTO') {
                          throw new Error('Debes seleccionar un evento valido.');
                        }

                        const { error } = await supabase.from('event_checkins').upsert(
                          {
                            event_id: eventId,
                            operator_user_id: operatorUserId,
                            checked_in_by: sessionUserId,
                            checkin_source: 'scanner_qr'
                          },
                          { onConflict: 'event_id,operator_user_id' }
                        );

                        if (error) {
                          throw error;
                        }
                      }}
                      onAssignTeam={async ({ eventId, operatorUserId, teamSlot }) => {
                        if (!supabase) {
                          throw new Error('Supabase no disponible.');
                        }

                        if (!eventId || eventId === 'SIN-EVENTO') {
                          throw new Error('Debes seleccionar un evento valido.');
                        }

                        const { error } = await supabase
                          .from('event_team_assignments')
                          .upsert(
                            {
                              event_id: eventId,
                              operator_user_id: operatorUserId,
                              team_slot: teamSlot,
                              assigned_by: sessionUserId
                            },
                            { onConflict: 'event_id,operator_user_id' }
                          );

                        if (error) {
                          throw error;
                        }
                      }}

                    />
                  </div>
                </details>
              ) : null}

              {activeAdminWorkspace === 'god' ? (
                <>
                  {activeGodWorkspace === 'users' ? <GodUserMaintainer enabled={isGodAdmin} /> : null}
                  {activeGodWorkspace === 'events' ? <GodEventsMaintainer enabled={isGodAdmin} /> : null}
                  {activeGodWorkspace === 'fields' ? <GodFieldMaintainer enabled={isGodAdmin} /> : null}

                  {isGodAdmin ? (
                    <FieldOperationsConsole
                      operatorNickname={(operatorData?.nickname || editForm.nickname || 'admin god').trim()}
                      operatorCredentialId={operatorData?.credentialId}
                      sessionUserId={sessionUserId}
                      allowedViews={['superadmin']}
                      initialView="superadmin"
                    />
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <p className="page-subtitle id-sync-text">
              No tienes permisos para acceder a Operaciones Cancha con esta cuenta.
            </p>
          )}
        </div>
      </section>

      {showCredentialModal && needsCredentialSetup ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 14, 16, 0.72)',
            backdropFilter: 'blur(3px)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem'
          }}
        >
          <div className="auth-card" style={{ width: 'min(760px, 100%)', maxHeight: '92vh', overflowY: 'auto' }}>
            {showingIdentityStep ? (
              <>
                <h1 className="page-title">Registro Inicial</h1>
                <p className="page-subtitle">Sesion activa con {sessionUserEmail ?? 'usuario'}.</p>
                <p className="page-subtitle">Completa identidad legal para habilitar tu credencial.</p>

                <form className="auth-form auth-form-registration" onSubmit={handleCompleteIdentityOnboarding}>
                  <label className="form-field is-readonly">
                    Correo electronico
                    <input value={sessionUserEmail ?? email} readOnly />
                  </label>
                  <label className="form-field">
                    RUT
                    <input
                      value={identityOnboardingForm.rut}
                      onChange={(e) => {
                        const formatted = formatRutInput(e.target.value);
                        setIdentityOnboardingForm((prev) => ({ ...prev, rut: formatted }));
                      }}
                      placeholder="12.345.678-9"
                      required
                    />
                  </label>
                  <label className="form-field">
                    Nombre legal
                    <input
                      value={identityOnboardingForm.fullName}
                      onChange={(e) => setIdentityOnboardingForm((prev) => ({ ...prev, fullName: e.target.value }))}
                      required
                    />
                  </label>

                  <div className="consent-stack" role="group" aria-label="Consentimientos obligatorios para completar identidad">
                    <label className="consent-check">
                      <input
                        type="checkbox"
                        checked={identityOnboardingForm.acceptPrivacy}
                        onChange={(e) => setIdentityOnboardingForm((prev) => ({ ...prev, acceptPrivacy: e.target.checked }))}
                        required
                      />
                      <span className="consent-copy">Acepto el aviso de privacidad (Ley N 19.628).</span>
                    </label>
                    <label className="consent-check">
                      <input
                        type="checkbox"
                        checked={identityOnboardingForm.acceptTerms}
                        onChange={(e) => setIdentityOnboardingForm((prev) => ({ ...prev, acceptTerms: e.target.checked }))}
                        required
                      />
                      <span className="consent-copy">Acepto terminos y condiciones de uso.</span>
                    </label>
                    <label className="consent-check">
                      <input
                        type="checkbox"
                        checked={identityOnboardingForm.acceptDataProcessing}
                        onChange={(e) => setIdentityOnboardingForm((prev) => ({ ...prev, acceptDataProcessing: e.target.checked }))}
                        required
                      />
                      <span className="consent-copy">Autorizo tratamiento de datos para autenticacion y operacion del servicio.</span>
                    </label>
                  </div>

                  <button type="submit" className="primary-btn primary-btn-full" disabled={identityOnboardingLoading}>
                    {identityOnboardingLoading ? 'Guardando...' : 'Confirmar identidad'}
                  </button>
                </form>

                {identityOnboardingError && <p className="error-text">{sanitizeUiMessage(identityOnboardingError)}</p>}
              </>
            ) : (
              <>
                <h1 className="page-title">Completa tu Registro de Operador</h1>
                <p className="page-subtitle">Sesion activa con {sessionUserEmail ?? 'usuario'}.</p>
                <p className="page-subtitle">Este paso habilita la credencial ID con tus datos de campo.</p>

                <form className="auth-form auth-form-registration" onSubmit={handleRegisterProfile}>
                  <label className="form-field is-readonly">
                    RUT (llave unica)
                    <input value={identityRut ?? 'No registrado en identidad'} readOnly />
                  </label>
                  <label className="form-field is-readonly">
                    Nombre legal
                    <input value={identityFullName ?? registrationForm.realName ?? 'Sin nombre legal'} readOnly />
                  </label>
                  <label className="form-field">
                    Nickname
                    <input
                      value={registrationForm.nickname}
                      onChange={(e) => setRegistrationForm((prev) => ({ ...prev, nickname: e.target.value }))}
                      required
                    />
                  </label>
                  <label className="form-field">
                    Grupo sanguineo
                    <select
                      value={registrationForm.bloodGroup}
                      onChange={(e) => setRegistrationForm((prev) => ({ ...prev, bloodGroup: e.target.value }))}
                    >
                      <option value="A+">A+</option>
                      <option value="A-">A-</option>
                      <option value="B+">B+</option>
                      <option value="B-">B-</option>
                      <option value="AB+">AB+</option>
                      <option value="AB-">AB-</option>
                      <option value="O+">O+</option>
                      <option value="O-">O-</option>
                    </select>
                  </label>
                  <label className="form-field">
                    Rol operador
                    <select
                      value={registrationForm.operatorRole}
                      onChange={(e) => setRegistrationForm((prev) => ({ ...prev, operatorRole: e.target.value }))}
                    >
                      <option value="assault">assault</option>
                      <option value="sniper">sniper</option>
                      <option value="medic">medic</option>
                      <option value="support">support</option>
                      <option value="dmr">dmr</option>
                      <option value="breacher">breacher</option>
                      <option value="recon">recon</option>
                      <option value="commander">commander</option>
                      <option value="other">other</option>
                    </select>
                  </label>
                  <label className="form-field">
                    Equipo
                    <input
                      value={registrationForm.team}
                      onChange={(e) => setRegistrationForm((prev) => ({ ...prev, team: e.target.value }))}
                    />
                  </label>
                  <label className="form-field">
                    Contacto emergencia
                    <input
                      value={registrationForm.emergencyContactName}
                      onChange={(e) => setRegistrationForm((prev) => ({ ...prev, emergencyContactName: e.target.value }))}
                      required
                    />
                  </label>
                  <label className="form-field">
                    Telefono emergencia
                    <input
                      value={registrationForm.emergencyContactPhone}
                      onChange={(e) => setRegistrationForm((prev) => ({ ...prev, emergencyContactPhone: e.target.value }))}
                      required
                    />
                  </label>
                  <label className="form-field">
                    URL avatar (opcional)
                    <input
                      value={registrationForm.avatarUrl}
                      onChange={(e) => setRegistrationForm((prev) => ({ ...prev, avatarUrl: e.target.value }))}
                      placeholder="https://..."
                    />
                  </label>
                  <button type="submit" className="primary-btn primary-btn-full" disabled={registrationLoading}>
                    {registrationLoading ? 'Registrando...' : 'Registrar perfil'}
                  </button>
                </form>

                {registrationError && <p className="error-text">{sanitizeUiMessage(registrationError)}</p>}
              </>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="ghost-btn" onClick={() => setShowCredentialModal(false)}>
                Recordar mas tarde
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
    </>
  );
}

export default App;
