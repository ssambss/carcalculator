import type { FinancingMethod, LeaseIncludes, Powertrain } from './types'

export const POWERTRAIN_LABEL: Record<Powertrain, string> = {
  petrol: 'Petrol',
  diesel: 'Diesel',
  ev: 'Electric',
  phev: 'Plug-in hybrid',
}

export const FINANCING_LABEL: Record<FinancingMethod, string> = {
  cash: 'Cash',
  loan: 'Loan',
  lease: 'Lease',
}

/** The yearly costs a full-service lease can cover, in form order. */
export const LEASE_INCLUDE_KEYS: (keyof LeaseIncludes)[] = [
  'insurance',
  'tax',
  'maintenance',
  'tires',
]

export const LEASE_INCLUDE_LABEL: Record<keyof LeaseIncludes, string> = {
  insurance: 'Insurance',
  tax: 'Vehicle tax',
  maintenance: 'Maintenance',
  tires: 'Tires',
}
