import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';

// ── Types ──────────────────────────────────────────────
export interface DashboardWidget {
  id: string;
  type: 'chart' | 'kpi';
  widgetKey: string;       // registry key e.g. 'wo-trend', 'oee-kpi'
  title: string;
  x: number; y: number;    // grid column, row
  w: number; h: number;    // grid span
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  createdAt: string;
  updatedAt: string;
}

interface DashboardState {
  dashboards: Dashboard[];
  activeDashboardId: string | null;
}

// ── Actions ────────────────────────────────────────────
type Action =
  | { type: 'INIT'; payload: DashboardState }
  | { type: 'CREATE_DASHBOARD'; payload: { name: string } }
  | { type: 'DELETE_DASHBOARD'; payload: { id: string } }
  | { type: 'RENAME_DASHBOARD'; payload: { id: string; name: string } }
  | { type: 'DUPLICATE_DASHBOARD'; payload: { id: string } }
  | { type: 'SET_ACTIVE'; payload: { id: string } }
  | { type: 'ADD_WIDGET'; payload: { dashboardId: string; widget: Omit<DashboardWidget, 'id' | 'x' | 'y'> } }
  | { type: 'REMOVE_WIDGET'; payload: { dashboardId: string; widgetId: string } }
  | { type: 'MOVE_WIDGET'; payload: { dashboardId: string; widgetId: string; x: number; y: number } }
  | { type: 'RESIZE_WIDGET'; payload: { dashboardId: string; widgetId: string; w: number; h: number } }
  | { type: 'REORDER_WIDGETS'; payload: { dashboardId: string; widgetIds: string[] } };

const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const STORAGE_KEY = 'ers_dashboards';

function persist(state: DashboardState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* quota exceeded — silently fail */ }
}

function loadState(): DashboardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt data */ }
  return { dashboards: [], activeDashboardId: null };
}

// ── Reducer ────────────────────────────────────────────
function reducer(state: DashboardState, action: Action): DashboardState {
  let next: DashboardState;

  switch (action.type) {
    case 'INIT':
      return action.payload;

    case 'CREATE_DASHBOARD': {
      const newDb: Dashboard = {
        id: uid(),
        name: action.payload.name,
        widgets: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      next = {
        dashboards: [...state.dashboards, newDb],
        activeDashboardId: newDb.id,
      };
      break;
    }

    case 'DELETE_DASHBOARD': {
      const remaining = state.dashboards.filter(d => d.id !== action.payload.id);
      next = {
        dashboards: remaining,
        activeDashboardId: state.activeDashboardId === action.payload.id
          ? (remaining[0]?.id ?? null)
          : state.activeDashboardId,
      };
      break;
    }

    case 'RENAME_DASHBOARD':
      next = {
        ...state,
        dashboards: state.dashboards.map(d =>
          d.id === action.payload.id ? { ...d, name: action.payload.name, updatedAt: new Date().toISOString() } : d
        ),
      };
      break;

    case 'DUPLICATE_DASHBOARD': {
      const src = state.dashboards.find(d => d.id === action.payload.id);
      if (!src) return state;
      const dup: Dashboard = {
        ...src,
        id: uid(),
        name: `${src.name} (Copy)`,
        widgets: src.widgets.map(w => ({ ...w, id: uid() })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      next = {
        dashboards: [...state.dashboards, dup],
        activeDashboardId: dup.id,
      };
      break;
    }

    case 'SET_ACTIVE':
      next = { ...state, activeDashboardId: action.payload.id };
      break;

    case 'ADD_WIDGET': {
      const { dashboardId, widget } = action.payload;
      next = {
        ...state,
        dashboards: state.dashboards.map(d => {
          if (d.id !== dashboardId) return d;
          // Auto-layout: place in next available slot
          const maxY = d.widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
          const newWidget: DashboardWidget = {
            ...widget,
            id: uid(),
            x: 0,
            y: maxY,
          };
          return { ...d, widgets: [...d.widgets, newWidget], updatedAt: new Date().toISOString() };
        }),
      };
      break;
    }

    case 'REMOVE_WIDGET':
      next = {
        ...state,
        dashboards: state.dashboards.map(d =>
          d.id === action.payload.dashboardId
            ? { ...d, widgets: d.widgets.filter(w => w.id !== action.payload.widgetId), updatedAt: new Date().toISOString() }
            : d
        ),
      };
      break;

    case 'MOVE_WIDGET':
      next = {
        ...state,
        dashboards: state.dashboards.map(d =>
          d.id === action.payload.dashboardId
            ? {
                ...d,
                widgets: d.widgets.map(w =>
                  w.id === action.payload.widgetId ? { ...w, x: action.payload.x, y: action.payload.y } : w
                ),
                updatedAt: new Date().toISOString(),
              }
            : d
        ),
      };
      break;

    case 'RESIZE_WIDGET':
      next = {
        ...state,
        dashboards: state.dashboards.map(d =>
          d.id === action.payload.dashboardId
            ? {
                ...d,
                widgets: d.widgets.map(w =>
                  w.id === action.payload.widgetId ? { ...w, w: action.payload.w, h: action.payload.h } : w
                ),
                updatedAt: new Date().toISOString(),
              }
            : d
        ),
      };
      break;

    case 'REORDER_WIDGETS':
      next = {
        ...state,
        dashboards: state.dashboards.map(d => {
          if (d.id !== action.payload.dashboardId) return d;
          const ordered = action.payload.widgetIds
            .map(id => d.widgets.find(w => w.id === id))
            .filter(Boolean) as DashboardWidget[];
          // Re-assign y positions sequentially
          let y = 0;
          const reordered = ordered.map(w => {
            const nw = { ...w, y };
            y += w.h;
            return nw;
          });
          return { ...d, widgets: reordered, updatedAt: new Date().toISOString() };
        }),
      };
      break;

    default:
      return state;
  }

  persist(next);
  return next;
}

// ── Context ────────────────────────────────────────────
interface DashboardContextValue {
  state: DashboardState;
  activeDashboard: Dashboard | null;
  createDashboard: (name: string) => void;
  deleteDashboard: (id: string) => void;
  renameDashboard: (id: string, name: string) => void;
  duplicateDashboard: (id: string) => void;
  setActive: (id: string) => void;
  addWidget: (dashboardId: string, widget: Omit<DashboardWidget, 'id' | 'x' | 'y'>) => void;
  removeWidget: (dashboardId: string, widgetId: string) => void;
  moveWidget: (dashboardId: string, widgetId: string, x: number, y: number) => void;
  resizeWidget: (dashboardId: string, widgetId: string, w: number, h: number) => void;
  reorderWidgets: (dashboardId: string, widgetIds: string[]) => void;
  pinToActiveDashboard: (widget: Omit<DashboardWidget, 'id' | 'x' | 'y'>) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, loadState());

  // Sync on mount (in case another tab changed localStorage)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try { dispatch({ type: 'INIT', payload: JSON.parse(e.newValue) }); } catch { /* noop */ }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const createDashboard = useCallback((name: string) => dispatch({ type: 'CREATE_DASHBOARD', payload: { name } }), []);
  const deleteDashboard = useCallback((id: string) => dispatch({ type: 'DELETE_DASHBOARD', payload: { id } }), []);
  const renameDashboard = useCallback((id: string, name: string) => dispatch({ type: 'RENAME_DASHBOARD', payload: { id, name } }), []);
  const duplicateDashboard = useCallback((id: string) => dispatch({ type: 'DUPLICATE_DASHBOARD', payload: { id } }), []);
  const setActive = useCallback((id: string) => dispatch({ type: 'SET_ACTIVE', payload: { id } }), []);
  const addWidget = useCallback((dashboardId: string, widget: Omit<DashboardWidget, 'id' | 'x' | 'y'>) =>
    dispatch({ type: 'ADD_WIDGET', payload: { dashboardId, widget } }), []);
  const removeWidget = useCallback((dashboardId: string, widgetId: string) =>
    dispatch({ type: 'REMOVE_WIDGET', payload: { dashboardId, widgetId } }), []);
  const moveWidget = useCallback((dashboardId: string, widgetId: string, x: number, y: number) =>
    dispatch({ type: 'MOVE_WIDGET', payload: { dashboardId, widgetId, x, y } }), []);
  const resizeWidget = useCallback((dashboardId: string, widgetId: string, w: number, h: number) =>
    dispatch({ type: 'RESIZE_WIDGET', payload: { dashboardId, widgetId, w, h } }), []);
  const reorderWidgets = useCallback((dashboardId: string, widgetIds: string[]) =>
    dispatch({ type: 'REORDER_WIDGETS', payload: { dashboardId, widgetIds } }), []);

  const activeDashboard = state.dashboards.find(d => d.id === state.activeDashboardId) ?? null;

  const pinToActiveDashboard = useCallback((widget: Omit<DashboardWidget, 'id' | 'x' | 'y'>) => {
    if (!state.activeDashboardId) {
      // Auto-create a dashboard if none exists
      dispatch({ type: 'CREATE_DASHBOARD', payload: { name: 'My Dashboard' } });
      // The new dashboard ID will be set after the next render — queue the add
      setTimeout(() => {
        const updated = loadState();
        const activeId = updated.activeDashboardId;
        if (activeId) dispatch({ type: 'ADD_WIDGET', payload: { dashboardId: activeId, widget } });
      }, 50);
    } else {
      dispatch({ type: 'ADD_WIDGET', payload: { dashboardId: state.activeDashboardId, widget } });
    }
  }, [state.activeDashboardId]);

  const value: DashboardContextValue = {
    state, activeDashboard,
    createDashboard, deleteDashboard, renameDashboard, duplicateDashboard,
    setActive, addWidget, removeWidget, moveWidget, resizeWidget, reorderWidgets,
    pinToActiveDashboard,
  };

  return React.createElement(DashboardContext.Provider, { value }, children);
};

export const useDashboardStore = (): DashboardContextValue => {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboardStore must be used within DashboardProvider');
  return ctx;
};
