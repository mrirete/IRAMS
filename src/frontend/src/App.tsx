import React, { Suspense } from 'react';
import { lazyWithReload, prefetchRegisteredRoutes } from './lib/lazyWithReload';
import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, ProtectedRoute, useAuth } from './contexts/AuthContext';
import { useEdition } from './lib/useEdition';
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
import { ErrorBoundary } from './eam/components/ErrorBoundary';
import { LoadingState } from './eam/components/ui';
// Admin pages — lazy loaded (admin-only, no need in main bundle)
const ConnectorHub = lazyWithReload(() => import('./pages/admin/ConnectorHub').then(m => ({ default: m.ConnectorHub })));
const ConnectorWizard = lazyWithReload(() => import('./pages/admin/ConnectorWizard').then(m => ({ default: m.ConnectorWizard })));
const ConnectorDetail = lazyWithReload(() => import('./pages/admin/ConnectorDetail').then(m => ({ default: m.ConnectorDetail })));
const GlobalSettingsPage = lazyWithReload(() => import('./pages/admin/GlobalSettingsPage').then(m => ({ default: m.GlobalSettingsPage })));
const ErrorLogsPage = lazyWithReload(() => import('./pages/admin/ErrorLogsPage').then(m => ({ default: m.ErrorLogsPage })));
const HierarchyConfigPage = lazyWithReload(() => import('./pages/HierarchyConfigPage').then(m => ({ default: m.HierarchyConfigPage })));
const ManufacturersPage = lazyWithReload(() => import('./pages/ManufacturersPage').then(m => ({ default: m.ManufacturersPage })));
const WorkCentersPage = lazyWithReload(() => import('./pages/WorkCentersPage').then(m => ({ default: m.WorkCentersPage })));
const CompaniesPage = lazyWithReload(() => import('./pages/CompaniesPage').then(m => ({ default: m.CompaniesPage })));
const AdminActivityPage = lazyWithReload(() => import('./pages/admin/AdminActivityPage').then(m => ({ default: m.AdminActivityPage })));
const InvitationsPage = lazyWithReload(() => import('./pages/admin/InvitationsPage').then(m => ({ default: m.InvitationsPage })));
const MigrationCenterPage = lazyWithReload(() => import('./pages/admin/MigrationCenterPage').then(m => ({ default: m.MigrationCenterPage })));
const SpecialistWorkspacePage = lazyWithReload(() => import('./pages/specialist/SpecialistWorkspacePage').then(m => ({ default: m.SpecialistWorkspacePage })));
const ImportWizardPage = lazyWithReload(() => import('./pages/specialist/ImportWizardPage').then(m => ({ default: m.ImportWizardPage })));
const AssessmentReportPage = lazyWithReload(() => import('./pages/specialist/AssessmentReportPage').then(m => ({ default: m.AssessmentReportPage })));
const DeliverWorkPage = lazyWithReload(() => import('./pages/specialist/DeliverWorkPage').then(m => ({ default: m.DeliverWorkPage })));
const ManualsPage = lazyWithReload(() => import('./pages/specialist/ManualsPage').then(m => ({ default: m.ManualsPage })));
const RoiStatementPage = lazyWithReload(() => import('./pages/specialist/RoiStatementPage').then(m => ({ default: m.RoiStatementPage })));
const MeetingPackPage = lazyWithReload(() => import('./pages/specialist/MeetingPackPage').then(m => ({ default: m.MeetingPackPage })));

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
const EamAcceptInvite = lazyWithReload(() => import('./eam/pages/AcceptInvite').then(m => ({ default: m.AcceptInvite })));
const EamDashboard = lazyWithReload(() => import('./eam/pages/Dashboard').then(m => ({ default: m.Dashboard })));
const EamMyWork = lazyWithReload(() => import('./eam/pages/MyWork').then(m => ({ default: m.MyWork })));
const EamAssets = lazyWithReload(() => import('./eam/pages/Assets').then(m => ({ default: m.Assets })));
const EamWorkOrders = lazyWithReload(() => import('./eam/pages/WorkOrders').then(m => ({ default: m.WorkOrders })));
const EamInventory = lazyWithReload(() => import('./eam/pages/Inventory').then(m => ({ default: m.Inventory })));
const EamContacts = lazyWithReload(() => import('./eam/pages/Contacts').then(m => ({ default: m.Contacts })));
const EamAdmin = lazyWithReload(() => import('./eam/pages/Admin').then(m => ({ default: m.Admin })));
const EamServiceRequests = lazyWithReload(() => import('./eam/pages/ServiceRequests').then(m => ({ default: m.ServiceRequests })));
const EamRecurringWork = lazyWithReload(() => import('./eam/pages/RecurringWork').then(m => ({ default: m.RecurringWork })));
const MaintenanceStrategiesPage = lazyWithReload(() => import('./pages/MaintenanceStrategiesPage').then(m => ({ default: m.MaintenanceStrategiesPage })));
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
const ReliabilityHomePage = lazyWithReload(() => import('./pages/ReliabilityHomePage').then(m => ({ default: m.ReliabilityHomePage })));
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
const RegulatoryPage = lazyWithReload(() => import('./pages/RegulatoryPage').then(m => ({ default: m.RegulatoryPage })));
const InspectionSchedulePage = lazyWithReload(() => import('./pages/InspectionSchedulePage').then(m => ({ default: m.InspectionSchedulePage })));
// Mechanical Integrity loop steps (each wraps two former flat pages as tabs)
const ComplyAssessPage = lazyWithReload(() => import('./pages/IntegrityLoopPages').then(m => ({ default: m.ComplyAssessPage })));
const ComplyMeasurePage = lazyWithReload(() => import('./pages/IntegrityLoopPages').then(m => ({ default: m.ComplyMeasurePage })));
const ComplyEvaluatePage = lazyWithReload(() => import('./pages/IntegrityLoopPages').then(m => ({ default: m.ComplyEvaluatePage })));
const AuditsPage = lazyWithReload(() => import('./pages/AuditsPage').then(m => ({ default: m.AuditsPage })));
const AuditTemplatesPage = lazyWithReload(() => import('./pages/AuditTemplatesPage').then(m => ({ default: m.AuditTemplatesPage })));
const AuditSchedulePage = lazyWithReload(() => import('./pages/AuditSchedulePage').then(m => ({ default: m.AuditSchedulePage })));
const AuditCorrectiveActionsPage = lazyWithReload(() => import('./pages/AuditCorrectiveActionsPage').then(m => ({ default: m.AuditCorrectiveActionsPage })));
const InspectionDetailPage = lazyWithReload(() => import('./pages/InspectionDetailPage'));

// ── Loading Fallback (route chunks) ─────────────────────
const Loading = () => <LoadingState label="Loading page…" />;

// ── Gated Route Helper ──────────────────────────────────
const Gated = ({ moduleId, children }: { moduleId: string; children: React.ReactNode }) => (
  <ModuleGate moduleId={moduleId as any}>
    <Suspense fallback={<Loading />}>{children}</Suspense>
  </ModuleGate>
);

// ── Role-based landing ──────────────────────────────────
// Field roles open on "My Work" (their jobs, one tap to execute) instead of the
// analytics dashboard. Everyone else keeps the dashboard.
const FIELD_ROLES = new Set(['TECHNICIAN']);
const RoleLanding = () => {
  const { role } = useAuth();
  const { edition, loaded } = useEdition();
  if (role && FIELD_ROLES.has(role.toUpperCase())) return <Navigate to="/my-work" replace />;
  // Specialist edition: the workspace IS home (strategy §5.2).
  if (loaded && edition === 'specialist') return <Navigate to="/specialist" replace />;
  return <PermissionGate module="dashboard"><EamDashboard /></PermissionGate>;
};

function App() {
  // Warm every route chunk over the boot connection shortly after first paint.
  // Chunk fetches issued later (at navigation time) can hit a stalled
  // connection and hang forever — prefetching while the network is provably
  // healthy means navigation normally never waits on a fetch at all.
  React.useEffect(() => {
    const t = window.setTimeout(prefetchRegisteredRoutes, 3000);
    return () => window.clearTimeout(t);
  }, []);

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
                    {/* Public — invite acceptance (the token in the URL is the credential) */}
                    <Route path="/invite/:token" element={<Suspense fallback={<Loading />}><EamAcceptInvite /></Suspense>} />
                    <Route
                      path="*"
                      element={
                        <ProtectedRoute>
                          <AppLayout>
                            <ErrorBoundary>
                            <Suspense fallback={<Loading />}>
                              <Routes>
                                {/* ═══════════════════════════════════════════ */}
                                {/* EAM PAGES — Permission-Gated (RBAC)       */}
                                {/* ═══════════════════════════════════════════ */}
                                <Route path="/" element={<RoleLanding />} />
                                <Route path="/dashboard" element={<PermissionGate module="dashboard"><EamDashboard /></PermissionGate>} />
                                <Route path="/my-work" element={<PermissionGate module="workOrders"><EamMyWork /></PermissionGate>} />
                                <Route path="/assets" element={<PermissionGate module="assets"><EamAssets /></PermissionGate>} />
                                <Route path="/work-orders" element={<PermissionGate module="workOrders"><EamWorkOrders /></PermissionGate>} />
                                <Route path="/work-orders/:jobId" element={<PermissionGate module="workOrders"><EamWorkOrders /></PermissionGate>} />
                                <Route path="/inventory" element={<PermissionGate module="inventory"><EamInventory onAnalyze={() => { }} /></PermissionGate>} />
                                <Route path="/contacts" element={<PermissionGate module="contacts"><EamContacts /></PermissionGate>} />
                                <Route path="/vendors" element={<PermissionGate module="vendors"><EamVendors /></PermissionGate>} />
                                <Route path="/requests" element={<PermissionGate module="requests"><EamServiceRequests /></PermissionGate>} />
                                <Route path="/recurring-work" element={<PermissionGate module="pm"><EamRecurringWork /></PermissionGate>} />
                                <Route path="/maintenance-strategies" element={<PermissionGate module="pm"><MaintenanceStrategiesPage /></PermissionGate>} />
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
                                <Route path="/specialist" element={<Gated moduleId="specialist"><SpecialistWorkspacePage /></Gated>} />
                                <Route path="/specialist/import" element={<Gated moduleId="specialist"><ImportWizardPage /></Gated>} />
                                <Route path="/specialist/assessment" element={<Gated moduleId="specialist"><AssessmentReportPage /></Gated>} />
                                <Route path="/specialist/deliver" element={<Gated moduleId="specialist"><DeliverWorkPage /></Gated>} />
                                <Route path="/specialist/manuals" element={<Gated moduleId="specialist"><ManualsPage /></Gated>} />
                                <Route path="/specialist/roi" element={<Gated moduleId="specialist"><RoiStatementPage /></Gated>} />
                                <Route path="/specialist/meeting" element={<Gated moduleId="specialist"><MeetingPackPage /></Gated>} />
                                <Route path="/predict" element={<Gated moduleId="predict"><PredictPage /></Gated>} />
                                <Route path="/reliability" element={<Gated moduleId="predict"><ReliabilityHomePage /></Gated>} />
                                <Route path="/reliability-metrics" element={<Gated moduleId="predict"><ReliabilityMetricsPage /></Gated>} />
                                <Route path="/reliability-modelling" element={<Gated moduleId="predict"><ReliabilityModellingPage /></Gated>} />
                                <Route path="/analyze" element={<Gated moduleId="predict"><AnalyzePage /></Gated>} />
                                <Route path="/analyze/rca/:investigationId" element={<Gated moduleId="predict"><RCAInvestigationPage /></Gated>} />
                                <Route path="/analyze/rca/:investigationId/report" element={<Gated moduleId="predict"><RCAReport /></Gated>} />
                                <Route path="/analyze/fmea/:worksheetId" element={<Gated moduleId="predict"><FMEAWorksheetDetail /></Gated>} />
                                <Route path="/rcm" element={<Gated moduleId="predict"><RCMPage /></Gated>} />
                                <Route path="/rcm/:studyId" element={<Gated moduleId="predict"><RCMPage /></Gated>} />


                                {/* Mechanical Integrity — the loop: Assess → Plan → Measure → Evaluate */}
                                <Route path="/comply/assess" element={<Gated moduleId="comply"><ComplyAssessPage /></Gated>} />
                                <Route path="/comply/inspection-schedule" element={<Gated moduleId="comply"><InspectionSchedulePage /></Gated>} />
                                <Route path="/comply/inspections/:inspectionId" element={<Gated moduleId="comply"><PermissionGate module="integrity"><InspectionDetailPage /></PermissionGate></Gated>} />
                                <Route path="/comply/measure" element={<Gated moduleId="comply"><ComplyMeasurePage /></Gated>} />
                                <Route path="/comply/evaluate" element={<Gated moduleId="comply"><ComplyEvaluatePage /></Gated>} />
                                {/* Legacy integrity paths → loop steps (?tab= picks the view) */}
                                <Route path="/comply/rbi" element={<Navigate to="/comply/assess" replace />} />
                                <Route path="/comply/damage-mechanisms" element={<Navigate to="/comply/assess?tab=dm" replace />} />
                                <Route path="/comply/corrosion-rates" element={<Navigate to="/comply/measure" replace />} />
                                <Route path="/comply/thickness-data" element={<Navigate to="/comply/measure?tab=readings" replace />} />
                                <Route path="/comply/ffs" element={<Navigate to="/comply/evaluate" replace />} />
                                <Route path="/comply/iow-dashboard" element={<Navigate to="/comply/evaluate?tab=iow" replace />} />
                                <Route path="/comply/regulatory-preparedness" element={<Navigate to="/comply/regulatory" replace />} />
                                {/* Process Safety */}
                                <Route path="/comply/psm" element={<Gated moduleId="safety"><PsmPage /></Gated>} />
                                <Route path="/comply/loto" element={<Gated moduleId="safety"><LotoPage /></Gated>} />
                                {/* Compliance & Audits */}
                                <Route path="/audits" element={<Gated moduleId="audits"><PermissionGate module="audits"><AuditsPage /></PermissionGate></Gated>} />
                                <Route path="/audits/templates" element={<Gated moduleId="audits"><PermissionGate module="audits"><AuditTemplatesPage /></PermissionGate></Gated>} />
                                <Route path="/audits/schedule" element={<Gated moduleId="audits"><PermissionGate module="audits"><AuditSchedulePage /></PermissionGate></Gated>} />
                                <Route path="/audits/corrective-actions" element={<Gated moduleId="audits"><PermissionGate module="audits"><AuditCorrectiveActionsPage /></PermissionGate></Gated>} />
                                <Route path="/comply/regulatory" element={<Gated moduleId="audits"><RegulatoryPage /></Gated>} />

                                {/* Intelligence tier (deferred — launchReady: false) */}
                                <Route path="/vision" element={<Gated moduleId="vision"><VisionPage /></Gated>} />
                                <Route path="/knowledge-graph" element={<Gated moduleId="intelligence"><KnowledgeGraphPage /></Gated>} />
                                <Route path="/data-quality" element={<Gated moduleId="intelligence"><DataQualityPage /></Gated>} />

                                {/* Sustainability tier (deferred — launchReady: false) */}
                                <Route path="/sustain" element={<Gated moduleId="sustain"><SustainPage /></Gated>} />

                                {/* Admin — ERS connector hub + EAM dictionaries/permissions */}
                                {/* Migration Center sits under /admin, not /specialist: it is
                                    PermissionGate'd (RBAC) rather than ModuleGate'd (licence),
                                    so a platform-edition tenant can still migrate its data in. */}
                                <Route path="/admin/migration" element={<PermissionGate module="admin"><MigrationCenterPage /></PermissionGate>} />
                                <Route path="/admin/invitations" element={<PermissionGate module="admin"><InvitationsPage /></PermissionGate>} />
                                <Route path="/admin/connectors" element={<PermissionGate module="admin"><ConnectorHub /></PermissionGate>} />
                                <Route path="/admin/connectors/new" element={<PermissionGate module="admin"><ConnectorWizard /></PermissionGate>} />
                                <Route path="/admin/connectors/:id" element={<PermissionGate module="admin"><ConnectorDetail /></PermissionGate>} />
                                <Route path="/admin/settings" element={<PermissionGate module="admin"><GlobalSettingsPage /></PermissionGate>} />
                                <Route path="/admin/hierarchy" element={<PermissionGate module="admin"><HierarchyConfigPage /></PermissionGate>} />
                                <Route path="/admin/manufacturers" element={<PermissionGate module="admin"><ManufacturersPage /></PermissionGate>} />
                                <Route path="/admin/work-centers" element={<PermissionGate module="admin"><WorkCentersPage /></PermissionGate>} />
                                <Route path="/admin/companies" element={<PermissionGate module="admin"><CompaniesPage /></PermissionGate>} />
                                <Route path="/admin/error-logs" element={<PermissionGate module="admin"><ErrorLogsPage /></PermissionGate>} />
                                <Route path="/admin/activity-log" element={<PermissionGate module="activityLog"><AdminActivityPage /></PermissionGate>} />
                              </Routes>
                            </Suspense>
                            </ErrorBoundary>
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
