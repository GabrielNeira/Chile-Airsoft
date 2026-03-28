import { FormEvent, useEffect, useState } from 'react';
import OperatorCredentialCard from './components/OperatorCredentialCard';
import OrganizerScannerView from './components/OrganizerScannerView';
import OperatorCareerHub from './components/OperatorCareerHub';
import PlayerLevelMetricsPanel from './components/PlayerLevelMetricsPanel';
import FieldOperationsConsole from './components/FieldOperationsConsole';
import { getOperatorIdMetricsByUserId, getOperatorMetricScoreByUserId } from './lib/operatorMetricsApi';
import { hasSupabaseConfig, supabase } from './lib/supabaseClient';

type AuthMode = 'login' | 'signup';

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

function App() {
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
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lastLookupRut, setLastLookupRut] = useState<string>('');
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
  const [idCardFile, setIdCardFile] = useState<File | null>(null);
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
  const [activeExperienceSection, setActiveExperienceSection] = useState<'id' | 'operations'>('id');

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
    const rawMessage = supabaseError?.message ?? 'Error desconocido';

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

    return rawMessage;
  }

  function inferFullNameFromApiPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const data = payload as Record<string, unknown>;

    // Common wrapper format: { status: 'success', data: { name: '...' } }
    const nestedData = (typeof data.data === 'object' && data.data !== null)
      ? (data.data as Record<string, unknown>)
      : null;

    const directKeys = [
      'full_name',
      'fullName',
      'nombre_completo',
      'razon_social',
      'razonSocial',
      'nombreCompleto',
      'name',
      'nombre'
    ];

    for (const key of directKeys) {
      const value = data[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }

      if (nestedData) {
        const nestedValue = nestedData[key];
        if (typeof nestedValue === 'string' && nestedValue.trim().length > 0) {
          return nestedValue.trim();
        }
      }
    }

    const nombres = typeof data.nombres === 'string' ? data.nombres.trim() : '';
    const apellidos = typeof data.apellidos === 'string' ? data.apellidos.trim() : '';
    const composed = `${nombres} ${apellidos}`.trim();
    if (composed.length > 0) {
      return composed;
    }

    if (nestedData) {
      const firstName = typeof nestedData.first_name === 'string' ? nestedData.first_name.trim() : '';
      const lastName = typeof nestedData.last_name === 'string' ? nestedData.last_name.trim() : '';
      const secondLastName = typeof nestedData.second_last_name === 'string' ? nestedData.second_last_name.trim() : '';
      const nestedComposed = `${firstName} ${lastName} ${secondLastName}`.replace(/\s+/g, ' ').trim();
      if (nestedComposed.length > 0) {
        return nestedComposed;
      }
    }

    return null;
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

  async function lookupIdentityFullNameByRut(rutToLookup: string): Promise<string> {
    if (!supabase) {
      throw new Error('Supabase no esta configurado para consultar identidad.');
    }

    const { data, error } = await supabase.functions.invoke('identity-lookup', {
      body: { rut: rutToLookup }
    });

    if (error) {
      const maybeContext = error as { context?: Response; message?: string };
      if (maybeContext.context) {
        try {
          const serverBody = await maybeContext.context.json() as { message?: string };
          if (serverBody?.message) {
            throw new Error(serverBody.message);
          }
        } catch {
          // fallback to generic message below
        }
      }

      throw new Error(maybeContext.message || 'No fue posible consultar identidad en este momento.');
    }

    const payload = data as Record<string, unknown> | null;
    const fullName = inferFullNameFromApiPayload(payload);
    if (!fullName) {
      throw new Error('La API no devolvio nombre utilizable para ese RUT.');
    }

    return fullName;
  }

  useEffect(() => {
    if (!needsIdentityOnboarding) {
      return;
    }

    const rutToLookup = identityOnboardingForm.rut.trim();
    if (!isValidRutValue(rutToLookup)) {
      return;
    }

    if (rutToLookup === lastLookupRut) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          setLookupLoading(true);
          setLookupError(null);
          const fullName = await lookupIdentityFullNameByRut(rutToLookup);
          setIdentityOnboardingForm((prev) => ({ ...prev, fullName }));
          setLastLookupRut(rutToLookup);
        } catch (error) {
          setLookupError((error as Error).message);
        } finally {
          setLookupLoading(false);
        }
      })();
    }, 450);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [needsIdentityOnboarding, identityOnboardingForm.rut, lastLookupRut]);

  function extractRutFromText(rawText: string): string | null {
    const dotted = rawText.match(/\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/);
    if (dotted?.[0]) {
      return dotted[0].toUpperCase();
    }

    const compact = rawText.match(/\b\d{7,8}[\dkK]\b/);
    if (!compact?.[0]) {
      return null;
    }

    const clean = compact[0].toUpperCase();
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);
    const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${withDots}-${dv}`;
  }

  async function detectRutFromIdCard(file: File): Promise<string | null> {
    const BarcodeDetectorApi = (window as Window & { BarcodeDetector?: any }).BarcodeDetector;
    if (!BarcodeDetectorApi) {
      return null;
    }

    try {
      const detector = new BarcodeDetectorApi({ formats: ['pdf417', 'qr_code'] });
      const bitmap = await createImageBitmap(file);
      const candidates = await detector.detect(bitmap);
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }

      for (const candidate of candidates as Array<{ rawValue?: string }>) {
        const payload = candidate.rawValue ?? '';
        const rut = extractRutFromText(payload);
        if (rut) {
          return rut;
        }
      }
    } catch {
      return null;
    }

    return null;
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
            const missingIdentity = !resolvedIdentityRut || !resolvedIdentityName;
            setNeedsIdentityOnboarding(missingIdentity);
            setNeedsRegistration(!missingIdentity);
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
            `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`co:${row?.nickname ?? profile.nickname}`)}`,
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
          setMetricsError((error as Error).message);
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
      setIdentityOnboardingError('Debes autocompletar o ingresar el nombre legal.');
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
        p_names_source: 'sii_api',
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
      setAuthError((error as Error).message);
    }
  }

  async function handleLogout() {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setOperatorData(null);
    setNeedsRegistration(false);
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
      setAuthError(error.message);
    }
  }

  async function handleRegisterProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !sessionUserId) {
      setRegistrationError('Debes iniciar sesion antes de registrar tu perfil.');
      return;
    }

    if (!idCardFile) {
      setRegistrationError('Debes adjuntar una foto de carnet para continuar.');
      return;
    }

    if (!rutSecretKey) {
      setRegistrationError('Falta VITE_RUT_SECRET_KEY en frontend/app/.env');
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
      setLookupError(null);

      const safeName = idCardFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${sessionUserId}/id-card-${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from('operator-id-documents')
        .upload(storagePath, idCardFile, { upsert: false });

      if (uploadError) {
        throw uploadError;
      }

      const idCardStorageUri = `storage://operator-id-documents/${storagePath}`;

      const { error: rpcError } = await supabase.rpc('register_my_operator_profile', {
        p_nickname: registrationForm.nickname,
        p_real_name: resolvedFullName,
        p_rut_plain: resolvedRut,
        p_rut_secret_key: rutSecretKey,
        p_blood_group: registrationForm.bloodGroup,
        p_team: registrationForm.team || null,
        p_operator_role: registrationForm.operatorRole,
        p_emergency_contact_name: registrationForm.emergencyContactName,
        p_emergency_contact_phone: registrationForm.emergencyContactPhone,
        p_avatar_url: registrationForm.avatarUrl || null,
        p_id_card_photo_url: idCardStorageUri
      });

      if (rpcError) {
        throw rpcError;
      }

      setNeedsRegistration(false);
      setIdCardFile(null);
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
            `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`co:${row.nickname}`)}`,
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

  async function handleRegistrationCardInput(file: File | null) {
    setIdCardFile(file);
    if (!file) {
      return;
    }

    const detectedRut = await detectRutFromIdCard(file);
    if (detectedRut) {
      setRegistrationForm((prev) => ({ ...prev, rut: detectedRut }));
      setRegistrationError(null);
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
            {authError && <p className="error-text" aria-live="assertive">{authError}</p>}
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

  if (needsIdentityOnboarding) {
    return (
      <main className="page-shell auth-shell">
        <div className="page-bg" />
        <section className="page-grid page-grid-auth">
          <div className="auth-card">
            <h1 className="page-title">Registro Inicial</h1>
            <p className="page-subtitle">Sesion activa con {sessionUserEmail ?? 'usuario'}.</p>
            <p className="page-subtitle">Completa identidad legal para continuar: RUT, nombre legal y consentimientos.</p>

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
                    setLastLookupRut('');
                    setLookupError(null);
                  }}
                  placeholder="12.345.678-9"
                  required
                />
              </label>
              <label className="form-field">
                Nombre legal (autocompletado API)
                <input
                  value={identityOnboardingForm.fullName}
                  onChange={(e) => setIdentityOnboardingForm((prev) => ({ ...prev, fullName: e.target.value }))}
                  required
                />
              </label>
              {lookupLoading && <p className="page-subtitle">Buscando nombre legal desde API chilena...</p>}

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

            {lookupError && <p className="error-text">{lookupError}</p>}
            {identityOnboardingError && <p className="error-text">{identityOnboardingError}</p>}

            <button type="button" className="ghost-btn" onClick={handleLogout}>
              Cerrar sesion
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (needsRegistration) {
    return (
      <main className="page-shell auth-shell">
        <div className="page-bg" />
        <section className="page-grid page-grid-auth">
          <div className="auth-card">
            <h1 className="page-title">Completa tu Registro de Operador</h1>
            <p className="page-subtitle">Sesion activa con {sessionUserEmail ?? 'usuario'}.</p>
            <p className="page-subtitle">Primer login detectado. Completa ahora los datos operativos restantes.</p>

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
              <label className="form-field file-field">
                Foto de carnet (obligatoria)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  capture="environment"
                  onChange={(e) => {
                    void handleRegistrationCardInput(e.target.files?.[0] ?? null);
                  }}
                  required
                />
              </label>

              <button type="submit" className="primary-btn primary-btn-full" disabled={registrationLoading}>
                {registrationLoading ? 'Registrando...' : 'Registrar perfil'}
              </button>
            </form>

            {registrationError && <p className="error-text">{registrationError}</p>}
            {authMessage && <p className="page-subtitle">{authMessage}</p>}

            <button type="button" className="ghost-btn" onClick={handleLogout}>
              Cerrar sesion
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell page-shell-id-focus">
      <div className="page-bg" />
      <section className="page-grid page-grid-id-focus">
        <div className="id-focus-column">
          <h1 className="page-title">ID Airsoft Chile</h1>
          <p className="page-subtitle id-session-subtitle">
            Sesion activa: {(operatorData?.nickname || editForm.nickname || 'operador').trim()}
          </p>

          <div className="id-actions" role="toolbar" aria-label="Acciones de cuenta">
            <button type="button" className="ghost-btn id-action-btn" onClick={handleLogout}>
              Cerrar sesion
            </button>
            {activeExperienceSection === 'id' ? (
              <button
                type="button"
                className={`ghost-btn id-action-btn ${editMode ? 'is-active' : ''}`}
                onClick={() => {
                  setEditMode((prev) => !prev);
                  setEditError(null);
                  setEditHint(null);
                }}
              >
                {editMode ? 'Cancelar edicion' : 'Editar mis datos'}
              </button>
            ) : null}
          </div>

          <div className="app-nav-tabs" role="tablist" aria-label="Modo de experiencia">
            <button
              type="button"
              role="tab"
              aria-selected={activeExperienceSection === 'id'}
              className={`app-nav-tab ${activeExperienceSection === 'id' ? 'is-active' : ''}`}
              onClick={() => setActiveExperienceSection('id')}
            >
              ID Operador
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeExperienceSection === 'operations'}
              className={`app-nav-tab ${activeExperienceSection === 'operations' ? 'is-active' : ''}`}
              onClick={() => setActiveExperienceSection('operations')}
            >
              Operaciones Cancha
            </button>
          </div>

          {activeExperienceSection === 'id' ? (
            <>
              {metricsLoading && <p className="page-subtitle id-sync-text">Sincronizando metricas...</p>}
              {metricsError && <p className="page-subtitle id-sync-text">Error metricas: {metricsError}</p>}

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
                  {editError && <p className="error-text">{editError}</p>}

                  <button type="submit" className="primary-btn" disabled={editLoading}>
                    {editLoading ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </form>
              )}

              <details className="id-secondary-tools">
                <summary>Herramientas avanzadas</summary>

                <div className="scanner-pane id-secondary-pane">
                  <OrganizerScannerView
                    eventId="EVT-LOCAL-001"
                    onResolveQr={async (rawQr) => {
                      if (!rawQr) {
                        throw new Error('Debes ingresar un QR');
                      }
                      return {
                        operatorUserId: 'operator-demo-uid',
                        nickname: 'GHOST-CL',
                        role: 'Assault',
                        bloodGroup: 'O+',
                        team: 'Santiago Wolves'
                      };
                    }}
                    onCheckin={async () => {
                      await Promise.resolve();
                    }}
                    onChronoValidate={async () => {
                      await Promise.resolve();
                    }}
                    onFairPlayReport={async () => {
                      await Promise.resolve();
                    }}
                  />
                </div>

                <section className="page-career id-secondary-pane">
                  <PlayerLevelMetricsPanel
                    level={3}
                    rankTitle="Recruit"
                    xpTotal={2680}
                    trustedScore={268}
                    verifiedMetrics={34}
                    pendingMetrics={3}
                    attendance30d={8}
                    chronoValidated30d={6}
                    fairPlayGreen30d={9}
                    fairPlayYellow30d={1}
                    fairPlayRed30d={0}
                  />

                  <OperatorCareerHub
                    xpTotal={2680}
                    level={3}
                    softTokens={1450}
                    premiumTokens={80}
                    equippedSkin="Multicam Pro"
                    equippedAnimation="Pulse Sweep"
                    missions={[
                      {
                        id: 'm-01',
                        title: 'Check-in Operativo',
                        description: 'Registra asistencia en 3 eventos oficiales durante la semana.',
                        progress: 2,
                        target: 3,
                        rewards: '300 XP + 120 Soft',
                        status: 'active'
                      },
                      {
                        id: 'm-02',
                        title: 'Fair Play Verde',
                        description: 'Completa 5 partidas sin penalizaciones.',
                        progress: 5,
                        target: 5,
                        rewards: '500 XP + Badge',
                        status: 'completed'
                      },
                      {
                        id: 'm-03',
                        title: 'Crono de Precision',
                        description: 'Valida crono oficial en 4 jornadas consecutivas.',
                        progress: 1,
                        target: 4,
                        rewards: '250 XP + 1 Skin',
                        status: 'active'
                      }
                    ]}
                    storeItems={[
                      { id: 's-01', name: 'Skin Woodland Phantom', rarity: 'Rare', price: '550 Soft' },
                      { id: 's-02', name: 'Animacion Ghost Pulse', rarity: 'Epic', price: '1200 Soft + 20 Premium' },
                      { id: 's-03', name: 'Badge Captain CL', rarity: 'Legendary', price: '80 Premium', owned: true }
                    ]}
                    achievements={[
                      { id: 'a-01', title: 'Operador Confiable', unlocked: true, progressLabel: '100% completado' },
                      { id: 'a-02', title: 'Iron Milsim', unlocked: false, progressLabel: '7 de 12 eventos largos' },
                      { id: 'a-03', title: 'Disciplina de Campo', unlocked: false, progressLabel: '3 de 10 fair play verde' }
                    ]}
                  />
                </section>
              </details>
            </>
          ) : (
            <FieldOperationsConsole
              operatorNickname={(operatorData?.nickname || editForm.nickname || 'admin cancha').trim()}
              operatorCredentialId={operatorData?.credentialId}
              sessionUserId={sessionUserId}
            />
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
