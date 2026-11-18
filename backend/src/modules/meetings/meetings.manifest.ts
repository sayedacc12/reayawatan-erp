import { ErpModuleManifest } from '../../platform/erp-module';

export const MEETINGS_PERMISSIONS = {
  read: 'meetings.dashboard.read',
  ga: 'meetings.general_assembly.read',
  board: 'meetings.board.read',
  committees: 'meetings.committees.read',
  teams: 'meetings.teams.read',
  manage: 'meetings.secretariat.manage',
  teamsManage: 'meetings.teams.manage',
  approve: 'meetings.plans.approve',
  reports: 'meetings.reports.read',
  settings: 'meetings.settings.manage',
} as const;

const P = MEETINGS_PERMISSIONS;

/** صلاحية الاطلاع على أرشيف كل نوع من الجهات */
export const KIND_READ: Record<string, string> = { general_assembly: P.ga, board: P.board, committee: P.committees, team: P.teams };

export const meetingsManifest: ErpModuleManifest = {
  code: 'meetings',
  name: 'الاجتماعات واللجان',
  description: 'اجتماعات الجمعية العمومية ومجلس الإدارة واللجان وفرق العمل: التخطيط والاعتماد والدعوات وتأكيد الحضور وجدول الأعمال والمناقشات والتوصيات، ومحضر يعتمد بالتوقيع الإلكتروني أو الحي، وتتحول توصياته إلى مهام',
  icon: 'meeting',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 91,
  depends: ['comms'],
  permissions: [
    { code: P.read, name: 'عرض لوحة الاجتماعات واجتماعاتي وسجل القرارات المتاح لي' },
    { code: P.ga, name: 'الاطلاع على اجتماعات الجمعية العمومية وقراراتها' },
    { code: P.board, name: 'الاطلاع على اجتماعات مجلس الإدارة وقراراته' },
    { code: P.committees, name: 'الاطلاع على اجتماعات اللجان المتخصصة وقراراتها' },
    { code: P.teams, name: 'الاطلاع على الاجتماعات الداخلية لفرق العمل' },
    { code: P.manage, name: 'أمانة المجالس: إدارة الجهات وأعضائها وتخطيط كل الاجتماعات وتحرير محاضرها' },
    { code: P.teamsManage, name: 'تنظيم اجتماعات فرق العمل الداخلية لفريقه' },
    { code: P.approve, name: 'اعتماد خطط الاجتماعات للجهات التي لم يحدد لها معتمد' },
    { code: P.reports, name: 'تقارير الاجتماعات والقرارات' },
    { code: P.settings, name: 'إعدادات الاجتماعات وصلاحياتها' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة الاجتماعات', path: '/meetings', permission: P.read },
    { label: 'الجمعية العمومية', path: '/meetings/k/general_assembly', permission: P.ga, group: 'الاجتماعات' },
    { label: 'مجلس الإدارة', path: '/meetings/k/board', permission: P.board, group: 'الاجتماعات' },
    { label: 'اللجان المتخصصة', path: '/meetings/k/committee', permission: P.committees, group: 'الاجتماعات' },
    { label: 'فرق العمل', path: '/meetings/k/team', permission: P.teams, group: 'الاجتماعات' },
    { label: 'سجل القرارات والتوصيات', path: '/meetings/decisions', permission: P.read },
    { label: 'المجالس واللجان وأعضاؤها', path: '/meetings/bodies', permission: P.read },
    { label: 'التقارير', path: '/meetings/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/meetings/settings', permission: P.settings },
  ],
};
