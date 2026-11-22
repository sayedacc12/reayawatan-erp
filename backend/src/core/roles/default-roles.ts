import { CORE_PERMISSIONS as C } from '../core.manifest';
import { ACC_PERMISSIONS as A } from '../../modules/accounting/accounting.manifest';
import { AUDIT_PERMISSIONS as AU } from '../../modules/audit/audit.manifest';
import { BILLING_PERMISSIONS as B } from '../../modules/billing/billing.manifest';
import { COMMS_PERMISSIONS as CM } from '../../modules/comms/comms.manifest';
import { CRM_PERMISSIONS as CR } from '../../modules/crm/crm.manifest';
import { GOV_PERMISSIONS as G } from '../../modules/governance/governance.manifest';
import { HR_PERMISSIONS as H } from '../../modules/hr/hr.manifest';
import { KNOWLEDGE_PERMISSIONS as K } from '../../modules/knowledge/knowledge.manifest';
import { MEETINGS_PERMISSIONS as M } from '../../modules/meetings/meetings.manifest';
import { MEMBER_PERMISSIONS as MB } from '../../modules/members/members.manifest';
import { PARTNERSHIP_PERMISSIONS as PT } from '../../modules/partnerships/partnerships.manifest';
import { PLANNING_PERMISSIONS as PL } from '../../modules/planning/planning.manifest';
import { PROCUREMENT_PERMISSIONS as PR } from '../../modules/procurement/procurement.manifest';
import { QUALITY_PERMISSIONS as Q } from '../../modules/quality/quality.manifest';
import { RISK_PERMISSIONS as R } from '../../modules/risk/risk.manifest';
import { VOL_PERMISSIONS as V } from '../../modules/volunteers/volunteers.manifest';
import { WEBSITE_PERMISSIONS as W } from '../../modules/website/website.manifest';

export interface DefaultRole { name: string; description: string; permissions: string[] }

/** ما يحتاجه كل موظف تقريبًا: معاملاته ومهامه، واجتماعاته، والأرشيف المنشور، وطلب صرف مواد */
const EVERYONE = [CM.read, M.read, M.teams, K.read, Q.read, R.read, PR.issueRequest];

/**
 * الأدوار الافتراضية لرعاية وطن: شركة استشارية صغيرة، يحمل الموظف فيها أكثر من دور حتى تُطوَّر «التكليفات».
 * تغطي معًا كل صلاحيات النظام (يتحقق منه اختبار default-roles.spec.ts).
 * الإعداد والاعتماد في دورين مختلفين قدر الإمكان، ويجوز إسنادهما لشخص واحد مؤقتًا (قرار المالك حتى تعيين فريق).
 * تُضاف للشركة مرة واحدة عند التشغيل، ثم يعدّلها مدير المنظمة أو يحذفها بحرية ولا تعود.
 */
export const DEFAULT_ROLES: DefaultRole[] = [
  {
    name: 'المدير التنفيذي',
    description: 'الاعتمادات العليا في كل الأنظمة: الرواتب والمشتريات والموازنات والخطط والجودة والمخاطر والحوكمة، مع الاطلاع على التقارير',
    permissions: [
      ...EVERYONE,
      A.read, A.reports, A.approveVouchers, A.approveReceiptCancel, A.reopenPeriods, A.assetsRead,
      H.read, H.reports, H.salaries, H.approveJobs, H.approvePlans, H.approvePayroll, H.approveSeparations, H.approveLeaves, H.approvePerformance, H.approveDevelopment,
      PR.read, PR.suppliersRead, PR.reports, PR.approveSuppliers, PR.approveRequests, PR.approveOrders, PR.approveOrdersHigh, PR.stockApprove, PR.issueApprove,
      PR.contractsApprove, PR.evaluationsApprove, PR.invoicesOverride,
      PL.read, PL.reports, PL.approve, PL.budgetsApprove,
      Q.approveDocs, Q.approveReviews, Q.reports,
      R.approveRegister, R.approveChange, R.approveCompliance, R.approveProcedures, R.activateCrisis, R.reports,
      G.read, G.approve, G.reports,
      AU.read, AU.approvePlans, AU.reports,
      PT.read, PT.approve, PT.reports,
      MB.read, MB.approve, MB.reports,
      V.read, V.approveEvents, V.reports,
      M.ga, M.board, M.committees, M.approve, M.reports,
      CM.registry, CM.registryMedium, CM.decisions, CM.tasksAll, CM.reports,
      B.read, B.reports, CR.read, CR.all, CR.reports, W.read, W.leadsRead, K.reports,
    ],
  },
  {
    name: 'المدير المالي',
    description: 'يعتمد السندات ويرحّل القيود ويغلق الفترات، ويعرّف البنوك والدليل، ويصدر الفواتير، ويعتمد الحسابات البنكية للموردين',
    permissions: [
      ...EVERYONE,
      A.read, A.setup, A.accounts, A.banks, A.approveVouchers, A.post, A.unpost, A.cancel, A.approveReceiptCancel, A.closePeriods,
      A.reports, A.settings, A.assetsRead, A.assetsDepreciate, A.assetsReverse, A.assetsBudget,
      B.read, B.issue, B.reports, B.settings,
      H.read, H.salaries, H.payPayroll, H.reports,
      PR.read, PR.suppliersRead, PR.approveBanks, PR.reports,
      PL.read, PL.budgets, PL.budgetsHr, PL.formulas, PL.reports,
      CM.financial, G.read,
    ],
  },
  {
    name: 'المحاسب',
    description: 'يعدّ سندات القبض والصرف والقيود، ودليل العملاء والموردين، والأصول الثابتة وعهدها، ومستحقات الموردين، والفواتير',
    permissions: [
      ...EVERYONE,
      A.read, A.partners, A.receipts, A.payments, A.entries, A.payables, A.reports,
      A.assetsRead, A.assetsManage, A.assetsOperate, A.assetsCustody, A.assetsMaintain,
      B.read, B.customers, B.items, B.invoices, B.reports,
      PR.read, PR.suppliersRead, PR.invoices, PR.reports,
      CM.financial,
    ],
  },
  {
    name: 'أخصائي الموارد البشرية',
    description: 'شؤون الموظفين: الهيكل والوظائف والعقود والحضور والإجازات والأداء والتطوير، وإعداد مسير الرواتب ومستحقات نهاية الخدمة (يعتمدها غيره)',
    permissions: [
      ...EVERYONE,
      H.read, H.structure, H.jobs, H.grades, H.competencies, H.plans, H.employees, H.salaries, H.attendance, H.payroll,
      H.separations, H.leaves, H.performance, H.development, H.policy, H.requests, H.approveRequests, H.reports, H.settings,
      PL.read,
    ],
  },
  {
    name: 'مسؤول المشتريات والمستودعات',
    description: 'الأصناف والمستودعات، وتسجيل الموردين، وطلبات الشراء والمنافسات والتعميدات، وعمليات المستودع، وعقود الموردين وتقييمهم (يعتمدها غيره)',
    permissions: [
      ...EVERYONE,
      PR.read, PR.items, PR.warehouses, PR.suppliersRead, PR.suppliers, PR.requests, PR.sourcing, PR.evaluate,
      PR.stockOperate, PR.contracts, PR.evaluations, PR.reports, PR.settings,
    ],
  },
  {
    name: 'مدير الاستشارات والمشاريع',
    description: 'يتابع العملاء المحتملين وجلسات التشخيص، ويوزعهم على الفريق، وينفذ الخطط التشغيلية ومؤشراتها، ويطلب المشتريات لمشاريعه',
    permissions: [
      ...EVERYONE,
      W.read, W.leadsRead, W.leadsManage, W.bookings,
      CR.read, CR.manage, CR.all, CR.assign, CR.reports,
      PL.read, PL.operational, PL.kpis, PL.progress, PL.reports,
      PT.read, PR.read, PR.requests, M.teamsManage, CM.create, CM.tasks, AU.respond,
    ],
  },
  {
    name: 'مسؤول تطوير الأعمال',
    description: 'علاقات العملاء والجهات: التسجيل والتأهيل والاستيراد والدمج، والشراكات وتقييمها وعقودها، وسجل العملاء في الفوترة',
    permissions: [
      ...EVERYONE,
      CR.read, CR.manage, CR.merge, CR.import, CR.reports, CR.settings,
      W.read, W.leadsRead, W.leadsManage,
      PT.read, PT.partners, PT.evaluate, PT.contracts, PT.reports, PT.settings,
      B.read, B.customers,
    ],
  },
  {
    name: 'مسؤول الموقع والمحتوى',
    description: 'صفحات الموقع وخدماته، ومكتبة الأدلة، وأوقات الإتاحة، وأرشيف المعرفة ونشر وثائقه',
    permissions: [
      ...EVERYONE,
      W.read, W.leadsRead, W.bookings, W.content, W.guides, W.settings,
      K.manage, K.publish, K.reports, K.settings,
    ],
  },
  {
    name: 'مسؤول الجودة',
    description: 'نظام الجودة ISO 9001: السياق والوثائق ومراجعتها، والمراجعات الداخلية، وعدم المطابقة، والأهداف، والشكاوى والرضا (يعتمد الوثائق ومراجعة الإدارة غيره)',
    permissions: [
      ...EVERYONE,
      Q.context, Q.documents, Q.reviewDocs, Q.audits, Q.ncr, Q.closeNcr, Q.risks, Q.objectives, Q.reviews, Q.feedback, Q.reports, Q.settings,
      K.manage,
    ],
  },
  {
    name: 'مسؤول المخاطر والالتزام',
    description: 'سجل المخاطر والضوابط، والتحليلات، وطلبات التغيير، والالتزام، واستمرارية الأعمال، والإجراءات والمنهجيات (يعتمدها غيره)',
    permissions: [
      ...EVERYONE,
      R.register, R.analysis, R.change, R.compliance, R.continuity, R.methodologies, R.procedures, R.guide, R.policy, R.reports, R.settings,
      G.read,
    ],
  },
  {
    name: 'مسؤول الحوكمة',
    description: 'التقييم الذاتي للحوكمة وشواهده، وخطة التحسين، وتقويم الالتزامات النظامية (اجتماعات المجلس والتقارير والمواعيد)',
    permissions: [...EVERYONE, G.read, G.assess, G.actions, G.calendar, G.reports, G.settings],
  },
  {
    name: 'المراجع الداخلي',
    description: 'المراجعة الداخلية: المجالات والخطط والمهام والعمل الميداني وإصدار التقارير والتحقق من التوصيات، مع اطلاع للقراءة على المالية والموارد البشرية والمشتريات',
    permissions: [
      ...EVERYONE,
      AU.read, AU.universe, AU.plans, AU.engagements, AU.fieldwork, AU.issue, AU.verify, AU.reports, AU.settings,
      A.read, A.reports, A.assetsRead, H.read, H.reports, PR.read, PR.suppliersRead, PR.reports, B.read, B.reports, G.read,
    ],
  },
  {
    name: 'مسؤول التخطيط والموازنات',
    description: 'الخطط الاستراتيجية والتشغيلية ومؤشراتها، وإعداد الموازنات التقديرية ومعادلاتها (يعتمدها غيره)',
    permissions: [
      ...EVERYONE,
      PL.read, PL.strategic, PL.operational, PL.kpis, PL.progress, PL.reports, PL.settings, PL.budgets, PL.formulas,
    ],
  },
  {
    name: 'السكرتارية والاتصالات الإدارية',
    description: 'المعاملات الواردة والصادرة وسجلها والقرارات والمهام، وأمانة الاجتماعات والمجالس ومحاضرها',
    permissions: [
      ...EVERYONE,
      CM.create, CM.registry, CM.tasks, CM.tasksAll, CM.reports, CM.settings,
      M.manage, M.teamsManage, M.ga, M.board, M.committees, M.reports, M.settings,
      K.manage,
    ],
  },
  {
    name: 'مسؤول العضوية والتطوع',
    description: 'طلبات العضوية والأعضاء واشتراكاتهم، والمتطوعون والفعاليات والشهادات والعقود والتذاكر (يعتمد الطلبات والفعاليات غيره)',
    permissions: [
      ...EVERYONE,
      MB.read, MB.applications, MB.members, MB.payments, MB.reports, MB.settings,
      V.read, V.volunteers, V.events, V.certificates, V.contracts, V.tickets, V.policy, V.reports, V.settings,
    ],
  },
  {
    name: 'مسؤول النظام والمستخدمين',
    description: 'حسابات المستخدمين والأدوار، وهوية الشركة، وطلبات الدعم الفني. لا يمنح أحدًا صلاحية لا يملكها هو',
    permissions: [...EVERYONE, C.usersRead, C.usersManage, C.rolesRead, C.rolesManage, C.identityManage, C.supportManage],
  },
  {
    name: 'موظف',
    description: 'الحد الأدنى لكل موظف: معاملاته ومهامه، واجتماعاته، والوثائق المنشورة، وطلب صرف مواد، ومتابعة توصيات المراجعة المسندة لجهته',
    permissions: [...EVERYONE, AU.respond],
  },
];
