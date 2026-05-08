import { DeploymentMode, ModuleKey } from '../../prisma/client';
import { BillingCycle } from '../enums/domain.enums';

export type PlanLimits = {
  maxCampuses: number | null;
};

export type PlanBlueprint = {
  key: string;
  name: string;
  description: string;
  basePrice: number | null;
  currency: string;
  billingCycle: BillingCycle;
  setupFee: number | null;
  deploymentModes: DeploymentMode[];
  defaultModules: ModuleKey[];
  limits: PlanLimits;
};

export const DEFAULT_PLAN_KEY = 'starter';

export const PLAN_BLUEPRINTS: PlanBlueprint[] = [
  {
    key: DEFAULT_PLAN_KEY,
    name: 'Starter',
    description:
      'Shared hosted Nexus with essential modules and limited customization.',
    basePrice: 15000,
    currency: 'PKR',
    billingCycle: BillingCycle.MONTHLY,
    setupFee: null,
    deploymentModes: [DeploymentMode.SHARED_HOSTED],
    defaultModules: [
      ModuleKey.ACADEMICS,
      ModuleKey.ATTENDANCE,
      ModuleKey.FINANCE,
      ModuleKey.PEOPLE,
      ModuleKey.REALTIME,
    ],
    limits: {
      maxCampuses: 1,
    },
  },
  {
    key: 'growth',
    name: 'Growth',
    description:
      'Enhanced branding, institution settings, and broader configuration.',
    basePrice: 35000,
    currency: 'PKR',
    billingCycle: BillingCycle.MONTHLY,
    setupFee: 25000,
    deploymentModes: [
      DeploymentMode.SHARED_HOSTED,
      DeploymentMode.DEDICATED_HOSTED,
    ],
    defaultModules: [
      ModuleKey.ACADEMICS,
      ModuleKey.ATTENDANCE,
      ModuleKey.FINANCE,
      ModuleKey.PEOPLE,
      ModuleKey.REPORTING,
      ModuleKey.REALTIME,
    ],
    limits: {
      maxCampuses: 3,
    },
  },
  {
    key: 'pro',
    name: 'Pro',
    description:
      'Advanced configuration, dedicated deployment options, and reporting.',
    basePrice: 75000,
    currency: 'PKR',
    billingCycle: BillingCycle.MONTHLY,
    setupFee: 50000,
    deploymentModes: [
      DeploymentMode.DEDICATED_HOSTED,
      DeploymentMode.SELF_HOSTED,
    ],
    defaultModules: [
      ModuleKey.ACADEMICS,
      ModuleKey.ATTENDANCE,
      ModuleKey.FINANCE,
      ModuleKey.PEOPLE,
      ModuleKey.REPORTING,
      ModuleKey.EXAMINATIONS,
      ModuleKey.DOCUMENTS,
      ModuleKey.REALTIME,
    ],
    limits: {
      maxCampuses: 10,
    },
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    description:
      'Enterprise-grade deployments with full platform coverage and extensions.',
    basePrice: null,
    currency: 'PKR',
    billingCycle: BillingCycle.CUSTOM,
    setupFee: null,
    deploymentModes: [
      DeploymentMode.DEDICATED_HOSTED,
      DeploymentMode.SELF_HOSTED,
    ],
    defaultModules: Object.values(ModuleKey),
    limits: {
      maxCampuses: null,
    },
  },
];

export function getPlanBlueprint(planKey: string) {
  return PLAN_BLUEPRINTS.find((plan) => plan.key === planKey.toLowerCase());
}
