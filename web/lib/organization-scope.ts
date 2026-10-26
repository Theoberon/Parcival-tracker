export const ORGANIZATION_SCOPE_COOKIE = 'parcival-org-scope';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined): value is string {
  return !!value && UUID.test(value);
}

export function organizationScopeFromCookie(cookieHeader: string): string | null {
  const entry = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${ORGANIZATION_SCOPE_COOKIE}=`));
  if (!entry) return null;
  const value = entry.slice(ORGANIZATION_SCOPE_COOKIE.length + 1);
  return isUuid(value) ? value : null;
}

export function setOrganizationScope(organizationId: string | null): void {
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = organizationId
    ? `${ORGANIZATION_SCOPE_COOKIE}=${encodeURIComponent(organizationId)}; path=/; max-age=2592000; samesite=lax${secure}`
    : `${ORGANIZATION_SCOPE_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
}
