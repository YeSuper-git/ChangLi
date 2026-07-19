export type NavVisibility = {
  subscriptions: boolean;
  downloads: boolean;
  completion: boolean;
};

export const NAV_VISIBILITY_STORAGE_KEY = 'changli_nav_visibility';

export const DEFAULT_NAV_VISIBILITY: NavVisibility = {
  subscriptions: true,
  downloads: true,
  completion: true,
};

export const NAV_VISIBILITY_CHANGED_EVENT = 'changli-nav-visibility-change';

export function readNavVisibility(): NavVisibility {
  try {
    const raw = localStorage.getItem(NAV_VISIBILITY_STORAGE_KEY);
    if (!raw) return DEFAULT_NAV_VISIBILITY;
    const parsed = JSON.parse(raw) as Partial<NavVisibility>;
    return { ...DEFAULT_NAV_VISIBILITY, ...parsed };
  } catch {
    return DEFAULT_NAV_VISIBILITY;
  }
}

export function saveNavVisibility(next: NavVisibility) {
  localStorage.setItem(NAV_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent<NavVisibility>(NAV_VISIBILITY_CHANGED_EVENT, { detail: next }));
}
