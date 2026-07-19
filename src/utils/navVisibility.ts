export type NavItemKey = 'home' | 'library' | 'actors' | 'tags' | 'subscriptions' | 'downloads' | 'completion';

export type NavVisibility = {
  home: boolean;
  library: boolean;
  actors: boolean;
  tags: boolean;
  subscriptions: boolean;
  downloads: boolean;
  completion: boolean;
  order: NavItemKey[];
};

export const NAV_VISIBILITY_STORAGE_KEY = 'changli_nav_visibility';

export const LOCKED_NAV_KEYS: NavItemKey[] = ['home', 'library'];
export const MOVABLE_NAV_KEYS: NavItemKey[] = ['actors', 'tags', 'subscriptions', 'downloads', 'completion'];
export const DEFAULT_NAV_ORDER: NavItemKey[] = [...LOCKED_NAV_KEYS, ...MOVABLE_NAV_KEYS];

export const DEFAULT_NAV_VISIBILITY: NavVisibility = {
  home: true,
  library: true,
  actors: true,
  tags: true,
  subscriptions: true,
  downloads: true,
  completion: true,
  order: DEFAULT_NAV_ORDER,
};

export const NAV_VISIBILITY_CHANGED_EVENT = 'changli-nav-visibility-change';

const normalizeOrder = (order?: NavItemKey[]): NavItemKey[] => {
  const savedMovable = Array.isArray(order)
    ? order.filter((key): key is NavItemKey => MOVABLE_NAV_KEYS.includes(key as NavItemKey))
    : [];
  const mergedMovable = [
    ...savedMovable,
    ...MOVABLE_NAV_KEYS.filter((key) => !savedMovable.includes(key)),
  ];
  return [...LOCKED_NAV_KEYS, ...mergedMovable];
};

export function readNavVisibility(): NavVisibility {
  try {
    const raw = localStorage.getItem(NAV_VISIBILITY_STORAGE_KEY);
    if (!raw) return DEFAULT_NAV_VISIBILITY;
    const parsed = JSON.parse(raw) as Partial<NavVisibility>;
    return {
      ...DEFAULT_NAV_VISIBILITY,
      ...parsed,
      home: true,
      library: true,
      order: normalizeOrder(parsed.order),
    };
  } catch {
    return DEFAULT_NAV_VISIBILITY;
  }
}

export function saveNavVisibility(next: NavVisibility) {
  const normalized = {
    ...next,
    home: true,
    library: true,
    order: normalizeOrder(next.order),
  };
  localStorage.setItem(NAV_VISIBILITY_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent<NavVisibility>(NAV_VISIBILITY_CHANGED_EVENT, { detail: normalized }));
}
