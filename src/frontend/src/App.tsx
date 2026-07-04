import React, { Suspense } from 'react';
import { lazyWithReload } from './lib/lazyWithReload';
import { Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, ProtectedRoute } from './contexts/AuthContext';
import { ToastProvider } from './eam/contexts/ToastContext';
import { ConfirmProvider } from './eam/contexts/ConfirmContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { LicenseProvider } from './contexts/LicenseContext';
import { AssetProvider } from './contexts/AssetContext';
import { RelanternProvider } from './eam/contexts/RelanternContext';
import { DashboardProvider } from './eam/stores/DashboardStore';
import { AppLayout } from './shell/AppLayout';
import { ModuleGate } from './components/ModuleGate';
import { UpdateBanner } from './components/UpdateBanner';
import { PermissionGate } from './eam/components/PermissionGate';
// Admin pages — lazy loaded (admin-only, no need in main bundle)
const ConnectorHub = lazyWithReload(() => import('./pages/admin/ConnectorHub').then(m => ({ default: m.ConnectorHub })));
const ConnectorWizard = lazyWithReload(() => import('./pages/admin/ConnectorWizard').then(m => ({ default: m.ConnectorWizard })));
const ConnectorDetail = lazyWithReload(() => import('./pages/admin/ConnectorDetail').then(m => ({ default: m.ConnectorDetail })));
const GlobalSettingsPage = lazyWithReload(() => import('./pages/admin/GlobalSettingsPage').then(m => ({ default: m.GlobalSettingsPage })));
const ErrorLogsPage = lazyWithReload(() => import('./pages/admin/ErrorLogsPage').then(m => ({ default: m.ErrorLogsPage })));
const HierarchyConfigPage = lazyWithReload(() => import('./pages/HierarchyConfigPage').then(m => ({ default: m.HierarchyConfigPage })));
const ManufacturersPage = lazyWithReload(() => import('./pages/ManufacturersPage').then(m => ({ default: m.ManufacturersPage })));
const WorkCentersPage = lazyWithReload(() => import('./pages/WorkCentersPage').then(m => ({ default: m.WorkCentersPage })));
const AdminActivityPage = lazyWithReload(() => import('./pages/admin/AdminActivityPage').then(m => ({ default: m.AdminActivityPage })));

// ── React Query Client ──────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

// ── EAM pages (Supabase-backed, replace ERS mock pages) ─
const EamLogin = lazyWithReload(() => import('./eam/pages/Login').then(m => ({ default: m.Login })));
const EamDashboard = lazyWithReload(() => import('./eam/pages/Dashboard').then(m => ({ default: m.Dashboard })));
const EamAssets = lazyWithReload(() => import('./eam/pages/Assets').then(m => ({ default: m.Assets })));
const EamWorkOrders = lazyWithReload(() => import('./eam/pages/WorkOrders').then(m => ({ default: m.WorkOrders })));
const EamInventory = lazyWithReload(() => import('./eam/pages/Inventory').then(m => ({ default: m.Inventory })));
const EamContacts = lazyWithReload(() => import('./eam/pages/Contacts').then(m => ({ default: m.Contacts })));
const EamAdmin = lazyWithReload(() => import('./eam/pages/Admin').then(m => ({ default: m.Admin })));
const EamServiceRequests = lazyWithReload(() => import('./eam/pages/ServiceRequests').then(m => ({ default: m.ServiceRequests })));
const EamRecurringWork = lazyWithReload(() => import('./eam/pages/RecurringWork').then(m => ({ default: m.RecurringWork })));
const EamScheduling = lazyWithReload(() => import('./eam/pages/Scheduling').then(m => ({ default: m.Scheduling })));
const EamPurchaseOrders = lazyWithReload(() => import('./eam/pages/PurchaseOrders').then(m => ({ default: m.PurchaseOrders })));
const EamReadings = lazyWithReload(() => import('./eam/pages/Readings').then(m => ({ default: m.Readings })));
const EamNotifications = lazyWithReload(() => import('./eam/pages/Notifications').then(m => ({ default: m.Notifications })));
const EamVendors = lazyWithReload(() => import('./eam/pages/Vendors').then(m => ({ default: m.Vendors })));
const EamFinOps = lazyWithReload(() => import('./eam/pages/FinOps').then(m => ({ default: m.FinOps })));
const EamManagementOfChange = lazyWithReload(() => import('./eam/pages/ManagementOfChange').then(m => ({ default: m.ManagementOfChange })));
const EamReliabilityToolkit = lazyWithReload(() => import('./eam/pages/ReliabilityToolkit').then(m => ({ default: m.ReliabilityToolkit })));
// EAM Analytics removed — ERS Analyze module covers this
const EamTaskLibrary = lazyWithReload(() => import('./eam/pages/admin/TaskLibrary').then(m => ({ default: m.TaskLibraryManager })));
const EamSystemHealth = lazyWithReload(() => import('./eam/pages/SystemHealth').then(m => ({ default: m.SystemHealth })));
const EamReports = lazyWithReload(() => import('./eam/pages/Reports').then(m => ({ default: m.Reports })));
const EamReportDrillDown = lazyWithReload(() => import('./eam/pages/ReportDrillDown').then(m => ({ default: m.ReportDrillDown })));

// ── ERS-unique pages (preserved, no EAM equivalent) ─────
const PredictPage = lazyWithReload(() => import('./pages/PredictPage').then(m => ({ default: m.PredictPage })));
const AnalyzePage = lazyWithReload(() => import('./pages/AnalyzePage').then(m => ({ default: m.AnalyzePage })));
const ReliabilityModellingPage = lazyWithReload(() => import('./pages/ReliabilityModellingPage'));
const ReliabilityMetricsPage = lazyWithReload(() => import('./pages/ReliabilityMetricsPage').then(m => ({ default: m.ReliabilityMetricsPage })));
const RCAInvestigationPage = lazyWithReload(() => import('./pages/RCAInvestigationPage').then(m => ({ default: m.RCAInvestigationPage })));
const RCAReport = lazyWithReload(() => import('./components/analyze/RCAReport'));
const FMEAWorksheetDetail = lazyWithReload(() => import('./pages/FMEAWorksheetDetail'));
const VisionPage = lazyWithReload(() => import('./pages/VisionPage').then(m => ({ default: m.VisionPage })));
const SustainPage = lazyWithReload(() => import('./pages/SustainPage').then(m => ({ default: m.SustainPage })));
const DataQualityPage = lazyWithReload(() => import('./pages/DataQualityPage').then(m => ({ default: m.DataQualityPage })));
const KnowledgeGraphPage = lazyWithReload(() => import('./pages/KnowledgeGraphPage').then(m => ({ default: m.KnowledgeGraphPage })));
const RCMPage = lazyWithReload(() => import('./pages/RCMPage').then(m => ({ default: m.RCMPage })));

// Comply pages (ERS-unique)
const LotoPage = lazyWithReload(() => import('./pages/LotoPage').then(m => ({ default: m.LotoPage })));
const PsmPage = lazyWithReload(() => import('./pages/PsmPage').then(m => ({ default: m.PsmPage })));
const RbiPage = lazyWithReload(() => import('./pages/RbiPage').then(m => ({ default: m.RbiPage })));
const RegulatoryPage = lazyWithReload(() => import('./pages/RegulatoryPage').then(m => ({ default: m.RegulatoryPage })));
const InspectionSchedulePage = lazyWithReload(() => import('./pages/InspectionSchedulePage').then(m => ({ default: m.InspectionSchedulePage })));
const ThicknessDataPage = lazyWithReload(() => import('./pages/ThicknessDataPage').then(m => ({ default: m.ThicknessDataPage })));
const CorrosionRatesPage = lazyWithReload(() => import('./pages/CorrosionRatesPage').then(m => ({ default: m.CorrosionRatesPage })));
const DamageMechanismsPage = lazyWithReload(() => import('./pages/DamageMechanismsPage').then(m => ({ default: m.DamageMechanismsPage })));
const FfsPage = lazyWithReload(() => import('./pages/FfsPage').then(m => ({ default: m.FfsPage })));
const IowDashboardPage = lazyWithReload(() => import('./pages/IowDashboardPage').then(m => ({ default: m.IowDashboardPage })));
const AuditsPage = lazyWithReload(() => import('./pages/AuditsPage').then(m => ({ default: m.AuditsPage })));
const AuditTemplatesPage = lazyWithReload(() => import('./pages/AuditTemplatesPage').then(m => ({ default: m.AuditTemplatesPage })));
const AuditSchedulePage = lazyWithReload(() => import('./pages/AuditSchedulePage').then(m => ({ default: m.AuditSchedulePage })));
const AuditCorrectiveActionsPage = lazyWithReload(() => import('./pages/AuditCorrectiveActionsPage').then(m => ({ default: m.AuditCorrectiveActionsPage })));
const RegulatoryPreparednessPage = lazyWithReload(() => import('./pages/RegulatoryPreparednessPage').then(m => ({ default: m.RegulatoryPreparednessPage })));
const InspectionDetailPage = lazyWithReload(() => import('./pages/InspectionDetailPage'));

// ── Loading Fallback ────────────────────────────────────
// TEMP DIAGNOSTIC: log while the Suspense fallback (a lazy route chunk) is shown,
// so a stuck spinner is identifiable in the console (mount without a matching
// unmount == the chunk never finished loading).
const Loading = () => {
  React.useEffect(() => {
    const t0 = Date.now();
    console.log('[Suspense] route chunk loading… (spinner shown)');
    return () => console.log(`[Suspense] route chunk resolved after ${Date.now() - t0}ms`);
  }, []);
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-accent-cyan border-t-transparent rounded-full animate-spin" />
    </div>
  );
};

// ── Gated Route Helper ──────────────────────────────────
const Gated = ({ moduleId, children }: { moduleId: string; children: React.ReactNode }) => (
  <ModuleGate moduleId={moduleId as any}>
    <Suspense fallback={<Loading />}>{children}</Suspense>
  </ModuleGate>
);

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
          <SettingsProvider>
            <LicenseProvider>
              <AssetProvider>
                <RelanternProvider>
                <DashboardProvider>
                  <UpdateBanner />
                  <Routes>
                    {/* Public — Login (EAM Supabase auth) */}
                    <Route path="/login" element={<Suspense fallback={<Loading />}><EamLogin /></Suspense>} />
                    <Route
                      path="*"
                      element={
                        <ProtectedRoute>
                          <AppLayout>
                            <Suspense fallback={<Loading />}>
                              <Routes>
                                {/* ═══════════════════════════════════════════ */}
                                {/* EAM PAGES — Permission-Gated (RBAC)       */}
                                {/* ═══════════════════════════════════════════ */}
                                <Route path="/" element={<PermissionGate module="dashboard"><EamDashboard /></PermissionGate>} />
                                <Route path="/assets" element={<PermissionGate module="assets"><EamAssets /></PermissionGate>} />
                                <Route path="/work-orders" element={<PermissionGate module="workOrders"><EamWorkOrders /></PermissionGate>} />
                                <Route path="/work-orders/:jobId" element={<PermissionGate module="workOrders"><EamWorkOrders /></PermissionGate>} />
                                <Route path="/inventory" element={<PermissionGate module="inventory"><EamInventory onAnalyze={() => { }} /></PermissionGate>} />
                                <Route path="/contacts" element={<PermissionGate module="contacts"><EamContacts /></PermissionGate>} />
                                <Route path="/vendors" element={<PermissionGate module="vendors"><EamVendors /></PermissionGate>} />
                                <Route path="/requests" element={<PermissionGate module="requests"><EamServiceRequests /></PermissionGate>} />
                                <Route path="/recurring-work" element={<PermissionGate module="pm"><EamRecurringWork /></PermissionGate>} />
                                <Route path="/scheduling" element={<PermissionGate module="scheduling"><EamScheduling /></PermissionGate>} />
                                <Route path="/purchase-orders" element={<PermissionGate module="purchasing"><EamPurchaseOrders /></PermissionGate>} />
                                <Route path="/readings" element={<PermissionGate module="readings"><EamReadings /></PermissionGate>} />
                                <Route path="/finops" element={<PermissionGate module="finops"><EamFinOps /></PermissionGate>} />
                                <Route path="/notifications" element={<PermissionGate module="notifications"><EamNotifications /></PermissionGate>} />
                                <Route path="/task-library" element={<PermissionGate module="taskLibrary"><EamTaskLibrary /></PermissionGate>} />
                                <Route path="/management-of-change" element={<PermissionGate module="moc"><EamManagementOfChange /></PermissionGate>} />
                                <Route path="/reliability-toolkit" element={<PermissionGate module="analytics"><EamReliabilityToolkit /></PermissionGate>} />
                                <Route path="/system-health" element={<PermissionGate module="admin"><EamSystemHealth /></PermissionGate>} />
                                <Route path="/reports" element={<PermissionGate module="analytics"><EamReports /></PermissionGate>} />
                                <Route path="/reports/drilldown/:reportType" element={<PermissionGate module="analytics"><EamReportDrillDown /></PermissionGate>} />
                                <Route path="/eam-admin" element={<PermissionGate module="admin"><EamAdmin /></PermissionGate>} />

                                {/* ═══════════════════════════════════════════ */}
                                {/* ERS-UNIQUE PAGES (Intelligence/Reliability) */}
                                {/* ═══════════════════════════════════════════ */}
                                {/* Reliability tier */}
                                <Route path="/predict" element={<Gated moduleId="predict"><PredictPage /></Gated>} />
                                <Route path="/reliability-metrics" element={<Gated moduleId="predict"><ReliabilityMetricsPage /></Gated>} />
                                <Route path="/reliability-modelling" element={<Gated moduleId="predict"><ReliabilityModellingPage /></Gated>} />
                                <Route path="/analyze" element={<Gated moduleId="predict"><AnalyzePage /></Gated>} />
                                <Route path="/analyze/rca/:investigationId" element={<Gated moduleId="predict"><RCAInvestigationPage /></Gated>} />
                                <Route path="/analyze/rca/:investigationId/report" element={<Gated moduleId="predict"><RCAReport /></Gated>} />
                                <Route path="/analyze/fmea/:worksheetId" element={<Gated moduleId="predict"><FMEAWorksheetDetail /></Gated>} />
                                <Route path="/rcm" element={<Gated moduleId="predict"><RCMPage /></Gated>} />
                                <Route path="/rcm/:studyId" element={<Gated moduleId="predict"><RCMPage /></Gated>} />


                                {/* Integrity / Comply tier */}
                                <Route path="/comply/loto" element={<Gated moduleId="comply"><LotoPage /></Gated>} />
                                <Route path="/comply/psm" element={<Gated moduleId="comply"><PsmPage /></Gated>} />
                                <Route path="/comply/rbi" element={<Gated moduleId="comply"><RbiPage /></Gated>} />
                                <Route path="/comply/regulatory" element={<Gated moduleId="comply"><RegulatoryPage /></Gated>} />
                                <Route path="/comply/inspection-schedule" element={<Gated moduleId="comply"><InspectionSchedulePage /></Gated>} />
                                <Route path="/comply/inspections/:inspectionId" element={<Gated moduleId="comply"><PermissionGate module="integrity"><InspectionDetailPage /></PermissionGate></Gated>} />
                                <Route path="/comply/thickness-data" element={<Gated moduleId="comply"><ThicknessDataPage /></Gated>} />
                                <Route path="/comply/corrosion-rates" element={<Gated moduleId="comply"><CorrosionRatesPage /></Gated>} />
                                <Route path="/comply/damage-mechanisms" element={<Gated moduleId="comply"><DamageMechanismsPage /></Gated>} />
                                <Route path="/comply/ffs" element={<Gated moduleId="comply"><FfsPage /></Gated>} />
                                <Route path="/comply/iow-dashboard" element={<Gated moduleId="comply"><IowDashboardPage /></Gated>} />
                                {/* Audits — Standalone Module (entry-level client system) */}
                                <Route path="/audits" element={<Gated moduleId="audits"><PermissionGate module="audits"><AuditsPage /></PermissionGate></Gated>} />
                                <Route path="/audits/templates" element={<Gated moduleId="audits"><PermissionGate module="audits"><AuditTemplatesPage /></PermissionGate></Gated>} />
                                <Route path="/audits/schedule" element={<Gated moduleId="audits"><PermissionGate module="audits"><AuditSchedulePage /></PermissionGate></Gated>} />
                                <Route path="/audits/corrective-actions" element={<Gated moduleId="audits"><PermissionGate module="audits"><AuditCorrectiveActionsPage /></PermissionGate></Gated>} />
                                <Route path="/comply/regulatory-preparedness" element={<Gated moduleId="comply"><RegulatoryPreparednessPage /></Gated>} />

                                {/* Intelligence tier (deferred — launchReady: false) */}
                                <Route path="/vision" element={<Gated moduleId="vision"><VisionPage /></Gated>} />
                                <Route path="/knowledge-graph" element={<Gated moduleId="intelligence"><KnowledgeGraphPage /></Gated>} />
                                <Route path="/data-quality" element={<Gated moduleId="intelligence"><DataQualityPage /></Gated>} />

                                {/* Sustainability tier (deferred — launchReady: false) */}
                                <Route path="/sustain" element={<Gated moduleId="sustain"><SustainPage /></Gated>} />

                                {/* Admin — ERS connector hub + EAM dictionaries/permissions */}
                                <Route path="/admin/connectors" element={<PermissionGate module="admin"><ConnectorHub /></PermissionGate>} />
                                <Route path="/admin/connectors/new" element={<PermissionGate module="admin"><ConnectorWizard /></PermissionGate>} />
                                <Route path="/admin/connectors/:id" element={<PermissionGate module="admin"><ConnectorDetail /></PermissionGate>} />
                                <Route path="/admin/settings" element={<PermissionGate module="admin"><GlobalSettingsPage /></PermissionGate>} />
                                <Route path="/admin/hierarchy" element={<PermissionGate module="admin"><HierarchyConfigPage /></PermissionGate>} />
                                <Route path="/admin/manufacturers" element={<PermissionGate module="admin"><ManufacturersPage /></PermissionGate>} />
                                <Route path="/admin/work-centers" element={<PermissionGate module="admin"><WorkCentersPage /></PermissionGate>} />
                                <Route path="/admin/error-logs" element={<PermissionGate module="admin"><ErrorLogsPage /></PermissionGate>} />
                                <Route path="/admin/activity-log" element={<PermissionGate module="activityLog"><AdminActivityPage /></PermissionGate>} />
                              </Routes>
                            </Suspense>
                          </AppLayout>
                        </ProtectedRoute>
                      }
                    />
                  </Routes>
                </DashboardProvider>
                </RelanternProvider>
              </AssetProvider>
            </LicenseProvider>
          </SettingsProvider>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
