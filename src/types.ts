export type Severity = 'low' | 'medium' | 'high'
export type VerificationStatus = 'pending' | 'approved' | 'rejected'

export interface Sighting {
  id: string
  lat: number
  lng: number
  description: string
  severity: Severity
  dogCount?: number
  imageUrl?: string
  createdAt?: { toDate: () => Date } | Date
  expiresAt?: { toDate: () => Date } | Date
  verificationStatus: VerificationStatus
  aiReason?: string
  aiSummary?: string
  observedBehavior?: string
  aiConfidence?: number
  locationEvidence?: string
  testOnly?: boolean
}
